import type { CatalogItem, Conversation, ConvState, DraftOrder, Order, Store } from "../domain/types.js";
import { parseIntent } from "./intents.js";
import { mainMenu, sizeGuide } from "./menus.js";
import { dispatch } from "./handlers.js";

/** A message the bot wants to send back. */
export type Outgoing =
  | { kind: "text"; body: string }
  | { kind: "image"; url: string; caption?: string };

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
  message: { text?: string; hasImage: boolean };
  now: Date;
  /** How long to keep the bot quiet after a human handoff. */
  handoffPauseHours: number;
}

export interface HandlerOutput {
  replies: Outgoing[];
  nextState: ConvState;
  draft?: DraftOrder;
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
  const { conversation: conv, store, now } = input;
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

  // --- global intents (interrupt from any state) ---
  switch (intent.type) {
    case "talk_human":
      return applyOutput(input, handoff(input));
    case "greeting":
    case "menu":
      return applyOutput(input, {
        replies: [text(mainMenu(store))],
        nextState: "idle",
        draft: {},
        pauseUntil: null,
      });
    case "size_guide":
      return applyOutput(input, { replies: [text(sizeGuide(store))], nextState: conv.state });
    case "cancel": {
      const activeId = conv.active_order_id;
      if (activeId) {
        // There's a real order in flight — cancel it, not just the chat.
        return applyOutput(input, {
          replies: [
            text(`Listo, cancelamos tu pedido *#${activeId}*. Escribe *menu* para empezar de nuevo. 🙏`),
          ],
          nextState: "idle",
          draft: {},
          activeOrderId: null,
          effects: [{ type: "cancelOrder", orderId: activeId }],
        });
      }
      return applyOutput(input, {
        replies: [text("Listo, cancelado. Escribe *menu* para empezar de nuevo. 👍")],
        nextState: "idle",
        draft: {},
      });
    }
    default:
      break;
  }

  // --- state-specific handling ---
  return applyOutput(input, dispatch(intent, input));
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
