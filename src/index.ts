import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { BaileysTransport } from "./transport/baileys.js";
import type { IncomingMessage, MessagingTransport } from "./transport/types.js";
import { seedStore } from "./services/seed.js";
import { resolveStore } from "./stores/routing.js";
import {
  createOrder,
  getAllItems,
  getConversation,
  getOrder,
  getStoreById,
  saveConversation,
  updateOrder,
  upsertStore,
} from "./db/repositories.js";
import { reduce, type EngineResult } from "./engine/stateMachine.js";
import { ownerHandoffMessage, ownerOrderMessage } from "./services/notify.js";
import type { Conversation, Store } from "./domain/types.js";

function freshConversation(customerWa: string, storeId: string, now: Date): Conversation {
  return {
    customer_wa: customerWa,
    store_id: storeId,
    state: "idle",
    draft_order: {},
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
    message: { text: msg.text, hasImage: Boolean(msg.image) },
    now,
    handoffPauseHours: config.handoffPauseHours,
  });

  await performEffects(transport, store, result, msg, now);
  saveConversation(result.conversation);

  for (const reply of result.replies) {
    if (reply.kind === "text") await transport.sendText(msg.from, reply.body);
    else await transport.sendImage(msg.from, reply.url, reply.caption);
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
    }
  }
}

async function main() {
  mkdirSync(config.uploadsDir, { recursive: true });

  const store = seedStore(config.storeId);
  logger.info({ store: store.store_name }, "store ready");

  const transport: MessagingTransport = new BaileysTransport(config.authDir, config.pairPhone);
  transport.onMessage((msg) => handleMessage(transport, msg));

  await transport.start();

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
