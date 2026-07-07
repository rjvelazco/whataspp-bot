import type {
  CatalogItem,
  Conversation,
  ConvState,
  DraftOrder,
  FlowMenu,
  Order,
  Store,
} from "../domain/types.js";
import { parseIntent } from "./intents.js";
import { dispatch, handleGlobal, handleInfoIntent, showMenu } from "./handlers.js";
import { resolveIncoming } from "./routing.js";

/** A message the bot wants to send back. */
export type Outgoing =
  | { kind: "text"; body: string }
  | { kind: "image"; url: string; caption?: string }
  | { kind: "asset"; assetId: string };

/** A DB/IO action the (pure) engine asks index.ts to perform. */
export type Effect =
  | { type: "createOrder"; order: Omit<Order, "order_id" | "created_at"> }
  | { type: "saveReceipt" }
  | { type: "notifyOwner"; orderId: string }
  | { type: "notifyOwnerHandoff"; customerWa: string }
  | { type: "cancelOrder"; orderId: string };

export interface EngineInput {
  conversation: Conversation;
  store: Store;
  /** Active catalog items for this store (passed in so the engine stays pure/testable). */
  catalog: CatalogItem[];
  /** Configured menus (flow builder). Drives the greeting + option routing. */
  menus: FlowMenu[];
  message: { text?: string; hasImage: boolean };
  now: Date;
  /** How long to keep the bot quiet after a human handoff. */
  handoffPauseHours: number;
}

export interface HandlerOutput {
  replies: Outgoing[];
  nextState: ConvState;
  draft?: DraftOrder;
  /** When set, updates which configured menu the customer is currently viewing. */
  menuKey?: string | null;
  effects?: Effect[];
  pauseUntil?: string | null;
  activeOrderId?: string | null;
}

export interface EngineResult {
  replies: Outgoing[];
  conversation: Conversation;
  effects: Effect[];
}

export const text = (body: string): Outgoing => ({ kind: "text", body });

/** Build a full updated Conversation from a handler's partial output. */
function applyOutput(input: EngineInput, out: HandlerOutput): EngineResult {
  const conv = input.conversation;
  return {
    replies: out.replies,
    effects: out.effects ?? [],
    conversation: {
      ...conv,
      state: out.nextState,
      draft_order: out.draft ?? conv.draft_order,
      menu_key: out.menuKey !== undefined ? out.menuKey : conv.menu_key,
      active_order_id: out.activeOrderId !== undefined ? out.activeOrderId : conv.active_order_id,
      bot_paused_until: out.pauseUntil !== undefined ? out.pauseUntil : conv.bot_paused_until,
      updated_at: input.now.toISOString(),
    },
  };
}

/**
 * The bot brain: a pure function. Given current state + message + store/catalog,
 * returns replies, the next conversation, and side-effects to perform.
 */
export function reduce(input: EngineInput): EngineResult {
  const { conversation: conv, now } = input;
  const intent = parseIntent(input.message.text ?? "");

  // --- handoff pause: stay quiet while a human is handling this chat ---
  const pausedUntil = conv.bot_paused_until ? new Date(conv.bot_paused_until) : null;
  const isPaused = pausedUntil !== null && now < pausedUntil;
  const resumeRequested = intent.type === "greeting" || intent.type === "menu";
  if (isPaused && !resumeRequested) {
    // Bot is silent; only refresh updated_at.
    return applyOutput(input, { replies: [], nextState: conv.state });
  }

  // --- image (payment receipt) ---
  if (input.message.hasImage) {
    return applyOutput(input, handleImage(input));
  }

  // Route the message per the documented precedence (resolveIncoming is the single,
  // pure source of that ordering), then run the matching handler.
  const route = resolveIncoming(intent, conv, input.menus);
  switch (route.kind) {
    case "global":
      return applyOutput(input, handleGlobal(intent, input));
    case "info":
      // resolveIncoming only returns "info" for info intents, so this is defined.
      return applyOutput(input, handleInfoIntent(intent, input)!);
    case "trigger":
      return applyOutput(input, showMenu(route.menu, input));
    case "dispatch":
      return applyOutput(input, dispatch(intent, input));
  }
}

/** Human handoff: notify the owner and pause the bot for this customer (spec §2.8). */
export function handoff(input: EngineInput): HandlerOutput {
  const until = new Date(input.now.getTime() + input.handoffPauseHours * HOUR_MS).toISOString();
  return {
    replies: [
      text(
        `Claro, le aviso a ${input.store.owner_name}. Te escribirá pronto. 🙌\n` +
          `(El asistente automático se pausa mientras tanto.)`,
      ),
    ],
    nextState: "paused",
    pauseUntil: until,
    effects: [{ type: "notifyOwnerHandoff", customerWa: input.conversation.customer_wa }],
  };
}

/** A customer sent a photo. In awaiting_payment it's their receipt (spec §2.5). */
function handleImage(input: EngineInput): HandlerOutput {
  const { conversation: conv, store } = input;
  if (conv.state === "awaiting_payment" && conv.active_order_id) {
    return {
      replies: [
        text(
          `¡Gracias! Recibimos tu comprobante. ✅\n` +
            `${store.store_name} lo verificará y te confirma el envío pronto.`,
        ),
      ],
      nextState: "idle",
      effects: [{ type: "saveReceipt" }, { type: "notifyOwner", orderId: conv.active_order_id }],
    };
  }
  return {
    replies: [
      text("Recibí tu imagen 📷. Si es un comprobante de pago, primero haz tu pedido. Escribe *menu*."),
    ],
    nextState: conv.state,
  };
}

const HOUR_MS = 60 * 60 * 1000;
