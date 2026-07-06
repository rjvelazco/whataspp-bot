import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { WebServer } from "./web/server.js";
import { BaileysTransport } from "./transport/baileys.js";
import type { IncomingMessage, MessagingTransport } from "./transport/types.js";
import { seedStore } from "./services/seed.js";
import { resolveStore } from "./stores/routing.js";
import {
  createOrder,
  getAllItems,
  getAsset,
  getConversation,
  getMenus,
  getOrder,
  getStoreById,
  listAssets,
  listCustomerJids,
  saveConversation,
  updateOrder,
  upsertStore,
} from "./db/repositories.js";
import { reduce, type EngineResult } from "./engine/stateMachine.js";
import { StoryScheduler } from "./services/storyScheduler.js";
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

async function handleMessage(transport: MessagingTransport, msg: IncomingMessage): Promise<void> {
  const store = resolveStore(msg.accountId);
  if (!store) {
    logger.warn({ accountId: msg.accountId }, "no store for account; ignoring");
    return;
  }

  const now = new Date();
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
    else if (reply.kind === "image") await transport.sendImage(msg.from, reply.url, reply.caption);
    else await sendAsset(transport, msg.from, reply.assetId);
  }
}

/** Send an uploaded asset (catalog/promo/story) as an image or document. */
async function sendAsset(transport: MessagingTransport, to: string, assetId: string): Promise<void> {
  const asset = getAsset(assetId);
  if (!asset) return; // deleted from the library — skip silently
  const path = join(config.uploadsDir, "assets", asset.filename);
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
        const buffer = await msg.image.download();
        const ext = msg.image.mimetype.split("/")[1] ?? "jpg";
        const path = join(config.uploadsDir, `receipt-${orderId}.${ext}`);
        writeFileSync(path, buffer);
        updateOrder({ ...order, receipt_url: path, status: "payment_submitted" });
        logger.info({ orderId, path }, "receipt saved");
        break;
      }
      case "notifyOwner": {
        const order = getOrder(effect.orderId);
        if (order) await transport.sendText(store.owner_whatsapp, ownerOrderMessage(order, store));
        break;
      }
      case "notifyOwnerHandoff": {
        await transport.sendText(store.owner_whatsapp, ownerHandoffMessage(effect.customerWa, store));
        break;
      }
      case "cancelOrder": {
        const order = getOrder(effect.orderId);
        if (order && (order.status === "pending_payment" || order.status === "payment_submitted")) {
          updateOrder({ ...order, status: "cancelled" });
          logger.info({ orderId: order.order_id }, "order cancelled by customer");
        }
        break;
      }
    }
  }
}

async function main() {
  mkdirSync(config.uploadsDir, { recursive: true });

  const store = seedStore(config.storeId);
  logger.info({ store: store.store_name }, "store ready");

  const transport: MessagingTransport = new BaileysTransport(config.authDir, config.pairPhone);
  transport.onMessage((msg) => handleMessage(transport, msg));

  let connected = false;

  // Posts the store's "story" assets to WhatsApp Status daily at the configured time.
  const storyScheduler = new StoryScheduler({
    getStore: () => getStoreById(store.store_id),
    listStories: () => listAssets(store.store_id).filter((a) => a.category === "story"),
    listAudience: () => listCustomerJids(store.store_id),
    postImage: (path, audience, caption) => transport.postStatusImage(path, audience, caption),
    isConnected: () => connected,
    uploadsDir: config.uploadsDir,
  });

  const web = new WebServer({
    store,
    sendMessage: (to, body) => transport.sendText(to, body),
    disconnect: () => transport.logout(),
    postStoryNow: () => storyScheduler.postNow(),
  });
  web.listen(config.webPort);

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
