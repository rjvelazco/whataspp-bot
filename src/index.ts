import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import QRCode from "qrcode";
import { config } from "./config.js";
import {
  containedPath,
  isSupportedReceiptType,
  productPhotoSource,
  receiptFilename,
} from "./domain/uploads.js";
import { logger } from "./logger.js";
import { silenceSignalNoise } from "./transport/silence-signal.js";
import { WebServer } from "./web/server.js";
import { BaileysTransport } from "./transport/baileys.js";
import type { IncomingMessage, MessagingTransport } from "./transport/types.js";
import { seedStore } from "./services/seed.js";
import { migrateStoredUploads } from "./db/index.js";
import { resolveStore } from "./stores/routing.js";
import {
  createOrder,
  getAllItems,
  getAsset,
  getConversation,
  getMenus,
  getOrder,
  getStory,
  getStoreById,
  listAssets,
  listContacts,
  listStories,
  markStoryPosted,
  saveConversation,
  saveStory,
  updateOrder,
  upsertContact,
  upsertStore,
} from "./db/repositories.js";
import { reduce, type EngineResult } from "./engine/stateMachine.js";
import { canTransition } from "./domain/orderStatus.js";
import { StoryScheduler } from "./services/storyScheduler.js";
import { deleteStoryAndMedia, resolveStoryMedia } from "./services/stories.js";
import { migrateLegacyStorySchedule } from "./db/migrateStories.js";
import { ownerHandoffMessage, ownerOrderMessage } from "./services/notify.js";
import type { Conversation, Store } from "./domain/types.js";

function freshConversation(customerWa: string, storeId: string, now: Date): Conversation {
  return {
    customer_wa: customerWa,
    store_id: storeId,
    state: "idle",
    draft_order: {},
    menu_key: null,
    active_order_id: null,
    bot_paused_until: null,
    updated_at: now.toISOString(),
  };
}

/**
 * One in-flight message per customer. handleMessage is a read-modify-write
 * (getConversation → reduce → saveConversation), so two messages arriving close
 * together would both read the same state and the second save would discard the
 * first — losing a draft, or emitting createOrder twice.
 */
const queues = new Map<string, Promise<void>>();

function serialize(key: string, task: () => Promise<void>): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous
    .then(task)
    .catch((err) => logger.error({ err, customer: key }, "message handler failed"))
    .finally(() => {
      // Only drop the entry if nothing newer has queued behind us.
      if (queues.get(key) === next) queues.delete(key);
    });
  queues.set(key, next);
  return next;
}

async function handleMessage(transport: MessagingTransport, msg: IncomingMessage): Promise<void> {
  const store = resolveStore(msg.accountId);
  if (!store) {
    logger.warn({ accountId: msg.accountId }, "no store for account; ignoring");
    return;
  }

  const now = new Date();
  // Record phone-jid senders as contacts (the Status audience). @lid-only senders can't
  // receive a Status anyway, so we skip them — which also avoids duplicate contact rows.
  if (msg.from.endsWith("@s.whatsapp.net")) {
    upsertContact(store.store_id, msg.from, msg.name ?? null, now.toISOString());
  }

  const conv =
    getConversation(msg.from, store.store_id) ?? freshConversation(msg.from, store.store_id, now);

  const result: EngineResult = reduce({
    conversation: conv,
    store,
    catalog: getAllItems(store.store_id),
    menus: getMenus(store.store_id),
    message: { text: msg.text, hasImage: Boolean(msg.image) },
    now,
    handoffPauseHours: config.handoffPauseHours,
  });

  await performEffects(transport, store, result, msg, now);
  saveConversation(result.conversation);

  for (const reply of result.replies) {
    if (reply.kind === "text") await transport.sendText(msg.from, reply.body);
    else if (reply.kind === "image") await sendProductPhoto(transport, msg.from, reply);
    else await sendAsset(transport, msg.from, reply.assetId);
  }
}

/**
 * Send a product photo. `photo_url` holds a bare filename (or a remote URL for seeded
 * products), so it has to be rejoined with productsDir before the transport sees it —
 * exactly what sendAsset below already does for library files.
 */
async function sendProductPhoto(
  transport: MessagingTransport,
  to: string,
  reply: { url: string; caption?: string },
): Promise<void> {
  const source = productPhotoSource(reply.url, config.productsDir);
  if (!source) {
    logger.warn({ photo: reply.url }, "skipping product photo outside uploads/products");
    return;
  }
  await transport.sendImage(to, source, reply.caption);
}

/** Send an uploaded asset (catalog/story) as an image or document. */
async function sendAsset(
  transport: MessagingTransport,
  to: string,
  assetId: string,
): Promise<void> {
  const asset = getAsset(assetId);
  if (!asset) return; // deleted from the library — skip silently
  const path = join(config.assetsDir, asset.filename);
  if (asset.mimetype.startsWith("image/")) {
    await transport.sendImage(to, path);
  } else {
    await transport.sendDocument(to, path, asset.original_name, asset.mimetype);
  }
}

/** Perform the engine's requested side-effects (the only place that touches IO + DB writes). */
async function performEffects(
  transport: MessagingTransport,
  store: Store,
  result: EngineResult,
  msg: IncomingMessage,
  now: Date,
): Promise<void> {
  for (const effect of result.effects) {
    switch (effect.type) {
      case "createOrder": {
        const order = createOrder(effect.order, now.toISOString());
        result.conversation.active_order_id = order.order_id;
        logger.info({ orderId: order.order_id }, "order created");
        break;
      }
      case "saveReceipt": {
        const orderId = result.conversation.active_order_id;
        if (!orderId || !msg.image) break;
        const order = getOrder(orderId);
        if (!order) break;
        if (!isSupportedReceiptType(msg.image.mimetype)) {
          // Storing it anyway would mean guessing an extension, and the file is served
          // with nosniff and a type inferred from that extension — so a wrong guess is a
          // receipt the browser refuses to render.
          logger.warn({ orderId, mimetype: msg.image.mimetype }, "unsupported receipt type");
          break;
        }
        const buffer = await msg.image.download();
        // Store the bare filename; the directory is rejoined at read time. See
        // src/domain/uploads.ts for why an absolute path here was a bug.
        const filename = receiptFilename(orderId, msg.image.mimetype);
        mkdirSync(config.receiptsDir, { recursive: true });
        // Write to a temporary name and rename into place: the filename is deterministic
        // per order, so a re-sent comprobante overwrites the previous one, and the admin
        // could otherwise read a half-written image.
        const target = join(config.receiptsDir, filename);
        const staging = `${target}.tmp-${randomUUID()}`;
        writeFileSync(staging, buffer);
        renameSync(staging, target);
        // A re-send under a different mimetype lands on a different name, which would
        // leave the old file behind with nothing pointing at it.
        const previous = order.receipt_url;
        if (previous && previous !== filename) {
          const stale = containedPath(config.receiptsDir, previous);
          if (stale) rmSync(stale, { force: true });
        }
        updateOrder({ ...order, receipt_url: filename, status: "payment_submitted" });
        logger.info({ orderId, filename }, "receipt saved");
        break;
      }
      case "notifyOwner": {
        const order = getOrder(effect.orderId);
        if (order) await transport.sendText(store.owner_whatsapp, ownerOrderMessage(order, store));
        break;
      }
      case "notifyOwnerHandoff": {
        await transport.sendText(
          store.owner_whatsapp,
          ownerHandoffMessage(effect.customerWa, store),
        );
        break;
      }
      case "cancelOrder": {
        const order = getOrder(effect.orderId);
        if (order && canTransition(order.status, "cancelled")) {
          updateOrder({ ...order, status: "cancelled" });
          logger.info({ orderId: order.order_id }, "order cancelled by customer");
        }
        break;
      }
    }
  }
}

async function main() {
  silenceSignalNoise();
  mkdirSync(config.uploadsDir, { recursive: true });
  mkdirSync(config.receiptsDir, { recursive: true });
  migrateStoredUploads();

  const store = seedStore(config.storeId);
  logger.info({ store: store.store_name }, "store ready");

  // The store-wide daily schedule became one scheduled story. Runs after seedStore,
  // which is what guarantees the store row exists to read the old setting from.
  migrateLegacyStorySchedule({
    getStore: () => getStoreById(store.store_id),
    listStoryAssets: () => listAssets(store.store_id).filter((a) => a.category === "story"),
    listStories: () => listStories(store.store_id),
    saveStory,
    newId: () => randomUUID(),
    now: () => new Date(),
  });

  const transport: MessagingTransport = new BaileysTransport(config.authDir, config.pairPhone);
  transport.onMessage((msg) => serialize(msg.from, () => handleMessage(transport, msg)));

  let connected = false;

  // Publishes scheduled Estados to WhatsApp Status.
  const storyScheduler = new StoryScheduler({
    listStories: () => listStories(store.store_id),
    getStory,
    // Status recipients must be phone jids (@s.whatsapp.net). Use the contacts table,
    // dropping legacy @lid entries, and always include the bot's own number.
    listAudience: () => {
      const own = transport.getAccountId();
      const customers = listContacts(store.store_id)
        .map((c) => c.wa_jid)
        .filter((j) => j.endsWith("@s.whatsapp.net"));
      return [...new Set([own, ...customers].filter(Boolean))];
    },
    postImage: (path, audience, caption) => transport.postStatusImage(path, audience, caption),
    postVideo: (path, audience, caption) => transport.postStatusVideo(path, audience, caption),
    isConnected: () => connected,
    resolveMedia: (story) => resolveStoryMedia(story, config.assetsDir),
    markPosted: markStoryPosted,
    discardStory: (story) => deleteStoryAndMedia(story.id, config.assetsDir),
  });

  const web = new WebServer({
    // Read-through, so admin edits to the store take effect without a restart.
    getStore: () => getStoreById(store.store_id) ?? store,
    sendMessage: (to, body) => transport.sendText(to, body),
    disconnect: () => transport.logout(),
    postStoryNow: (storyId) => storyScheduler.postNow(storyId),
  });
  web.listen(config.webPort, config.webHost);

  // Relay connection lifecycle to the web UI (render the QR string to an image).
  transport.onConnectionUpdate((update) => {
    connected = update.state === "open";
    if (update.state === "qr" && update.qr) {
      QRCode.toDataURL(update.qr, { margin: 1, width: 320 })
        .then((qrDataUrl) => web.setStatus({ state: "qr", qrDataUrl }))
        .catch((err) => logger.error({ err }, "failed to render QR"));
    } else if (update.state === "connecting") {
      web.setStatus({ state: "connecting" });
    } else if (update.state === "open") {
      web.setStatus({ state: "open", accountId: update.accountId ?? "" });
    }
  });

  await transport.start();
  storyScheduler.start();

  // Bind this bot's account to the store so resolveStore() can route by account later.
  const accountId = transport.getAccountId();
  const persisted = getStoreById(store.store_id);
  if (persisted && persisted.account_id !== accountId) {
    upsertStore({ ...persisted, account_id: accountId });
    logger.info({ accountId }, "bound bot account to store");
  }

  logger.info("Bot is running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
