import type { DraftOrder, OrderItem } from "../domain/types.js";
import type { Intent } from "./intents.js";
import { normalize } from "./intents.js";
import type { EngineInput, HandlerOutput } from "./stateMachine.js";
import { text } from "./stateMachine.js";
import { numberedList } from "./menus.js";
import { availableColors, availableSizes } from "./catalog.js";
import { paymentInstructions } from "./payment.js";

const itemForDraft = (input: EngineInput, draft: DraftOrder) =>
  input.catalog.find((it) => it.code === draft.code);

/** Resolve a numbered choice or a typed value against a list of options. */
function pick(intent: Intent, options: string[]): string | undefined {
  if (intent.type === "choice" && intent.index >= 1 && intent.index <= options.length) {
    return options[intent.index - 1];
  }
  if (intent.type === "text") {
    const norm = normalize(intent.value);
    return options.find((o) => normalize(o) === norm);
  }
  return undefined;
}

/** Begin an order from a product code (spec §2.4). */
export function startOrder(code: string, input: EngineInput): HandlerOutput {
  const item = input.catalog.find((it) => it.code === code);
  if (!item) {
    return { replies: [text(`No encontré el código *${code}* 🤔. Escribe *catálogo* para ver los productos.`)], nextState: "idle" };
  }
  const sizes = availableSizes(item);
  if (!sizes.length) {
    return { replies: [text(`😕 El *${item.name}* está agotado por ahora. Escribe *menu*.`)], nextState: "idle" };
  }
  return {
    replies: [text(`¡Buena elección! *${item.name}*.`), text(numberedList("¿Qué talla?", sizes))],
    nextState: "ordering_size",
    draft: { code: item.code, name: item.name, price: item.price },
  };
}

export function handleOrderingSize(intent: Intent, input: EngineInput): HandlerOutput {
  const draft = input.conversation.draft_order;
  const item = itemForDraft(input, draft);
  if (!item) return restart();
  const sizes = availableSizes(item);
  const size = pick(intent, sizes);
  if (!size) return reprompt(input, numberedList("¿Qué talla?", sizes));

  const colors = availableColors(item, size);
  return {
    replies: [text(numberedList("¿Color?", colors))],
    nextState: "ordering_color",
    draft: { ...draft, size },
  };
}

export function handleOrderingColor(intent: Intent, input: EngineInput): HandlerOutput {
  const draft = input.conversation.draft_order;
  const item = itemForDraft(input, draft);
  if (!item || !draft.size) return restart();
  const colors = availableColors(item, draft.size);
  const color = pick(intent, colors);
  if (!color) return reprompt(input, numberedList("¿Color?", colors));

  return {
    replies: [text("¿Cuántas unidades?")],
    nextState: "ordering_qty",
    draft: { ...draft, color },
  };
}

export function handleOrderingQty(intent: Intent, input: EngineInput): HandlerOutput {
  const draft = input.conversation.draft_order;
  if (intent.type !== "choice" || intent.index < 1) {
    return reprompt(input, "Indícame la cantidad con un número, por ejemplo *1*.");
  }
  return {
    replies: [text("¿A nombre de quién es el pedido?")],
    nextState: "ordering_name",
    draft: { ...draft, qty: intent.index },
  };
}

export function handleOrderingName(intent: Intent, input: EngineInput): HandlerOutput {
  const draft = input.conversation.draft_order;
  const name = intent.type === "text" ? intent.value : "";
  if (!name) return reprompt(input, "¿A nombre de quién es el pedido?");
  return {
    replies: [text("¿Dirección / zona de entrega?")],
    nextState: "ordering_address",
    draft: { ...draft, customer_name: name },
  };
}

export function handleOrderingAddress(intent: Intent, input: EngineInput): HandlerOutput {
  const draft = input.conversation.draft_order;
  const address = intent.type === "text" ? intent.value : "";
  if (!address) return reprompt(input, "¿Dirección / zona de entrega?");
  const next = { ...draft, delivery_address: address };
  return {
    replies: [text(summary(next))],
    nextState: "confirming",
    draft: next,
  };
}

export function handleConfirming(intent: Intent, input: EngineInput): HandlerOutput {
  const draft = input.conversation.draft_order;
  if (intent.type !== "confirm") {
    return reprompt(input, "Escribe *confirmar* para crear tu pedido o *cancelar* para descartarlo.");
  }
  const item = orderItem(draft);
  if (!item) return restart();
  const subtotal = item.price * item.qty;

  return {
    replies: [
      text(`¡Pedido confirmado! 🎉`),
      text(paymentInstructions(input.store)),
    ],
    nextState: "awaiting_payment",
    draft: {},
    effects: [
      {
        type: "createOrder",
        order: {
          store_id: input.store.store_id,
          customer_wa: input.conversation.customer_wa,
          customer_name: draft.customer_name ?? "",
          items: [item],
          delivery_address: draft.delivery_address ?? "",
          subtotal,
          status: "pending_payment",
          receipt_url: null,
        },
      },
    ],
  };
}

// ---------- helpers ----------

function orderItem(draft: DraftOrder): OrderItem | undefined {
  if (!draft.code || !draft.size || !draft.color || !draft.qty || draft.price === undefined) {
    return undefined;
  }
  return {
    code: draft.code,
    name: draft.name,
    size: draft.size,
    color: draft.color,
    qty: draft.qty,
    price: draft.price,
  };
}

function summary(d: DraftOrder): string {
  const total = (d.price ?? 0) * (d.qty ?? 0);
  return (
    `Confirmemos tu pedido:\n` +
    `• *${d.name}* — Talla ${d.size} — ${d.color} — x${d.qty}\n` +
    `• Total: $${total.toFixed(2)} + envío\n` +
    `• Para: ${d.customer_name} · ${d.delivery_address}\n\n` +
    `Escribe *confirmar* o *cancelar*.`
  );
}

const reprompt = (input: EngineInput, body: string): HandlerOutput => ({
  replies: [text(body)],
  nextState: input.conversation.state,
});

const restart = (): HandlerOutput => ({
  replies: [text("Se perdió el hilo del pedido 😅. Escribe *menu* para empezar de nuevo.")],
  nextState: "idle",
  draft: {},
});
