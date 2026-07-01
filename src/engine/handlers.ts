import type { CatalogItem } from "../domain/types.js";
import type { Intent } from "./intents.js";
import type { EngineInput, HandlerOutput, Outgoing } from "./stateMachine.js";
import { handoff, text } from "./stateMachine.js";
import { categoryMenu, shippingAndPayments } from "./menus.js";
import { availabilityMessage, detectSize, itemCard, matchItem } from "./catalog.js";
import {
  handleConfirming,
  handleOrderingAddress,
  handleOrderingColor,
  handleOrderingName,
  handleOrderingQty,
  handleOrderingSize,
  startOrder,
} from "./order.js";

const stay = (input: EngineInput, replies: Outgoing[]): HandlerOutput => ({
  replies,
  nextState: input.conversation.state,
});

const dontUnderstand = (input: EngineInput): HandlerOutput =>
  stay(input, [text("No te entendí 🤔. Escribe *menu* para ver las opciones.")]);

/** Route a parsed intent through the per-state logic. */
export function dispatch(intent: Intent, input: EngineInput): HandlerOutput {
  // "PEDIR <code>" starts an order from any state.
  if (intent.type === "order_code") {
    return startOrder(intent.code, input);
  }
  switch (input.conversation.state) {
    case "idle":
      return handleIdle(intent, input);
    case "choosing_category":
      return handleChoosingCategory(intent, input);
    case "browsing":
      return handleBrowsing(intent, input);
    case "checking_size":
      return handleCheckingSize(intent, input);
    case "ordering_size":
      return handleOrderingSize(intent, input);
    case "ordering_color":
      return handleOrderingColor(intent, input);
    case "ordering_qty":
      return handleOrderingQty(intent, input);
    case "ordering_name":
      return handleOrderingName(intent, input);
    case "ordering_address":
      return handleOrderingAddress(intent, input);
    case "confirming":
      return handleConfirming(intent, input);
    default:
      return dontUnderstand(input);
  }
}

/** Main-menu selection. */
function handleIdle(intent: Intent, input: EngineInput): HandlerOutput {
  if (intent.type === "text") {
    // Catch natural availability questions like "¿tienen el vestido bohemio en M?"
    const answer = tryAvailability(intent.value, input);
    if (answer) return answer;
  }
  if (intent.type !== "choice") return dontUnderstand(input);
  switch (intent.index) {
    case 1: // Ver catálogo
      return { replies: [text(categoryMenu(input.store))], nextState: "choosing_category" };
    case 2: // Consultar talla / disponibilidad
      return {
        replies: [
          text("¿Qué prenda y talla quieres consultar? Por ejemplo: *¿tienen el vestido bohemio en M?*"),
        ],
        nextState: "checking_size",
      };
    case 3: // Hacer pedido
      return {
        replies: [
          text("Para pedir, escribe *PEDIR <código>* del producto (verás el código en el catálogo). Ej: *PEDIR VESTBOHEMIO*."),
          text(categoryMenu(input.store)),
        ],
        nextState: "choosing_category",
      };
    case 4: // Envíos y pagos
      return stay(input, [text(shippingAndPayments(input.store))]);
    case 5: // Hablar con alguien
      return handoff(input);
    default:
      return stay(input, [text("Esa opción aún no está disponible. Escribe *menu*.")]);
  }
}

/** Pick a category → list its items as image cards (spec §2.2). */
function handleChoosingCategory(intent: Intent, input: EngineInput): HandlerOutput {
  const categories = input.store.categories;
  if (intent.type !== "choice" || intent.index < 1 || intent.index > categories.length) {
    return stay(input, [text(categoryMenu(input.store))]);
  }
  const category = categories[intent.index - 1];
  const items = input.catalog.filter((it) => it.category === category);
  if (!items.length) {
    return {
      replies: [text(`Por ahora no hay productos en *${category}*. Escribe *menu* para volver.`)],
      nextState: "idle",
    };
  }
  return { replies: itemCards(items, category), nextState: "browsing" };
}

/** While browsing, an availability question or another category pick. */
function handleBrowsing(intent: Intent, input: EngineInput): HandlerOutput {
  if (intent.type === "text") {
    const answer = tryAvailability(intent.value, input);
    if (answer) return answer;
  }
  return stay(input, [
    text("Escribe *PEDIR <código>* para ordenar, o *menu* para volver al inicio."),
  ]);
}

/** The dedicated availability/sizing flow (spec §2.3). */
function handleCheckingSize(intent: Intent, input: EngineInput): HandlerOutput {
  const query = intent.type === "text" ? intent.value : "";
  const answer = tryAvailability(query, input);
  if (answer) return answer;
  return stay(input, [
    text(
      "No encontré esa prenda 🔎. Dime el nombre como aparece en el catálogo, o escribe *menu*.",
    ),
  ]);
}

// ---------- helpers ----------

function itemCards(items: CatalogItem[], category: string): Outgoing[] {
  const cards: Outgoing[] = items.map((it) => ({
    kind: "image",
    url: it.photo_url,
    caption: itemCard(it),
  }));
  cards.unshift(text(`📂 *${category}*`));
  cards.push(text("Escribe *PEDIR <código>* para ordenar, o *menu* para volver."));
  return cards;
}

/** If the text names a catalog item, answer its availability; otherwise undefined. */
function tryAvailability(query: string, input: EngineInput): HandlerOutput | undefined {
  const item = matchItem(input.catalog, query);
  if (!item) return undefined;
  const size = detectSize(query);
  return {
    replies: [text(availabilityMessage(item, size))],
    nextState: "checking_size",
  };
}
