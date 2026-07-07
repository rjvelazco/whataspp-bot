import type { CatalogItem, FlowMenu, FlowOption, Store } from "../domain/types.js";
import type { Intent } from "./intents.js";
import { normalize } from "./intents.js";
import type { EngineInput, HandlerOutput, Outgoing } from "./stateMachine.js";
import { handoff, text } from "./stateMachine.js";
import {
  exchangeRate,
  keycap,
  paymentMethods,
  shippingAndPayments,
  shippingInfo,
  sizeGuide,
  storeAddress,
  storeHours,
} from "./menus.js";
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
    case "in_menu":
      return handleMenu(intent, input);
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

/**
 * Global commands that interrupt from any state: human handoff, greeting/menu
 * (returns to the entry menu, clearing any draft), the size guide, and cancel.
 * Routing (resolveIncoming) guarantees only these intents reach here.
 */
export function handleGlobal(intent: Intent, input: EngineInput): HandlerOutput {
  const conv = input.conversation;
  switch (intent.type) {
    case "talk_human":
      return handoff(input);
    case "greeting":
    case "menu":
      return { ...showEntry(input), draft: {}, pauseUntil: null };
    case "size_guide":
      return { replies: [text(sizeGuide(input.store))], nextState: conv.state };
    case "cancel": {
      const activeId = conv.active_order_id;
      if (activeId) {
        // A real order is in flight — cancel it, not just the chat.
        return {
          replies: [
            text(`Listo, cancelamos tu pedido *#${activeId}*. Escribe *menu* para empezar de nuevo. 🙏`),
          ],
          nextState: "idle",
          draft: {},
          activeOrderId: null,
          effects: [{ type: "cancelOrder", orderId: activeId }],
        };
      }
      return {
        replies: [text("Listo, cancelado. Escribe *menu* para empezar de nuevo. 👍")],
        nextState: "idle",
        draft: {},
      };
    }
    default:
      return stay(input, []);
  }
}

/**
 * Global informational keywords (tasa, dirección, envíos, pagos, ofertas, horario).
 * Returns undefined when the intent isn't one of them. Called only while the customer
 * is navigating menus (see NAV_STATES) so it never hijacks an in-progress order.
 */
export function handleInfoIntent(intent: Intent, input: EngineInput): HandlerOutput | undefined {
  const store = input.store;
  switch (intent.type) {
    case "show_rate":
      return stay(input, [text(exchangeRate(store))]);
    case "show_address":
      return stay(input, [text(storeAddress(store))]);
    case "show_shipping":
      return stay(input, [text(shippingInfo(store))]);
    case "show_payment":
      return stay(input, [text(paymentMethods(store))]);
    case "hours":
      return stay(input, [text(storeHours(store))]);
    case "show_offers":
      return showOffers(input);
    default:
      return undefined;
  }
}

/** Render the "Ofertas" category, or a friendly nudge when there are none. */
function showOffers(input: EngineInput): HandlerOutput {
  const items = input.catalog.filter((it) => it.category.toLowerCase() === "ofertas");
  if (!items.length) {
    return stay(input, [
      text("Por ahora no tenemos ofertas activas. Escribe *catálogo* para ver todo. 🛍️"),
    ]);
  }
  return { replies: itemCards(items, "Ofertas"), nextState: "browsing" };
}

// ---------- configured-menu flow ----------

/** Replace {store_name} / {owner_name} placeholders in a configured message. */
export function fillPlaceholders(message: string, store: Store): string {
  return message.replaceAll("{store_name}", store.store_name).replaceAll("{owner_name}", store.owner_name);
}

export function findMenuByKey(menus: FlowMenu[], key: string): FlowMenu | undefined {
  return menus.find((m) => m.key === key);
}

/** The "home" menu: one triggered by hola/menu/inicio, else the first. */
export function findEntryMenu(menus: FlowMenu[]): FlowMenu | undefined {
  const entry = menus.find((m) => {
    const trigs = (m.trigger ?? "").split(",").map((t) => normalize(t));
    return trigs.includes("menu") || trigs.includes("inicio") || trigs.includes("hola");
  });
  return entry ?? menus[0];
}

/** A menu whose trigger keywords exactly match the message (for keyword jumps). */
export function findMenuByTrigger(menus: FlowMenu[], rawText: string): FlowMenu | undefined {
  const norm = normalize(rawText);
  if (!norm) return undefined;
  return menus.find((m) =>
    (m.trigger ?? "")
      .split(",")
      .map((t) => normalize(t))
      .filter(Boolean)
      .includes(norm),
  );
}

/** Render a configured menu: message + numbered options, plus any attachments. */
export function renderMenu(menu: FlowMenu, store: Store): Outgoing[] {
  const body = fillPlaceholders(menu.message, store);
  const full = menu.options.length
    ? `${body}\n\n${menu.options.map((o, i) => `${keycap(i + 1)} ${o.label}`).join("\n")}` +
      `\n\nResponde con el número de la opción.`
    : body;
  const replies: Outgoing[] = [text(full)];
  for (const id of menu.attachments ?? []) replies.push({ kind: "asset", assetId: id });
  return replies;
}

export function showMenu(menu: FlowMenu, input: EngineInput): HandlerOutput {
  return { replies: renderMenu(menu, input.store), nextState: "in_menu", menuKey: menu.key };
}

export function showEntry(input: EngineInput): HandlerOutput {
  const menu = findEntryMenu(input.menus);
  if (!menu) {
    return { replies: [text("¡Hola! 👋 Aún no hay un menú configurado.")], nextState: "idle", menuKey: null };
  }
  return showMenu(menu, input);
}

/** Execute an option's configured action. */
function executeOption(opt: FlowOption, input: EngineInput): HandlerOutput {
  switch (opt.action) {
    case "go_menu": {
      const target = opt.target ? findMenuByKey(input.menus, opt.target) : undefined;
      return target ? showMenu(target, input) : reShowCurrent(input);
    }
    case "show_category": {
      // 'value' holds the category; fall back to legacy 'target' for un-migrated data.
      const category = opt.value ?? opt.target ?? "";
      const items = input.catalog.filter((it) => it.category === category);
      if (!items.length) {
        return { replies: [text(`Por ahora no hay productos en *${category}*.`)], nextState: "in_menu" };
      }
      return { replies: itemCards(items, category), nextState: "browsing" };
    }
    case "start_order":
      return stay(input, [
        text("Para pedir, escribe *PEDIR <código>* del producto (lo ves en el catálogo). Ej: *PEDIR VESTBOHEMIO*."),
      ]);
    case "show_offers":
      return showOffers(input);
    case "show_payment":
      return stay(input, [text(paymentMethods(input.store))]);
    case "show_shipping":
      return stay(input, [text(shippingInfo(input.store))]);
    case "show_address":
      return stay(input, [text(storeAddress(input.store))]);
    case "show_rate":
      return stay(input, [text(exchangeRate(input.store))]);
    case "size_guide":
      return stay(input, [text(sizeGuide(input.store))]);
    case "shipping_payments":
      return stay(input, [text(shippingAndPayments(input.store))]);
    case "talk_human":
      return handoff(input);
  }
}

function reShowCurrent(input: EngineInput): HandlerOutput {
  const menu = findMenuByKey(input.menus, input.conversation.menu_key ?? "");
  return menu ? showMenu(menu, input) : showEntry(input);
}

/** At a configured menu: a numbered pick runs its option; free text tries availability. */
function handleMenu(intent: Intent, input: EngineInput): HandlerOutput {
  const menu = findMenuByKey(input.menus, input.conversation.menu_key ?? "");
  if (!menu) return showEntry(input);

  if (intent.type === "choice") {
    const opt = menu.options[intent.index - 1];
    if (!opt) return stay(input, [text("Esa opción no existe. Elige un número de la lista.")]);
    return executeOption(opt, input);
  }
  if (intent.type === "text") {
    const answer = tryAvailability(intent.value, input);
    if (answer) return answer;
  }
  return showMenu(menu, input); // re-show the current menu
}

/** First message with no menu shown yet → answer availability or show the entry menu. */
function handleIdle(intent: Intent, input: EngineInput): HandlerOutput {
  if (intent.type === "text") {
    const answer = tryAvailability(intent.value, input);
    if (answer) return answer;
  }
  return showEntry(input);
}

/** While browsing, an availability question or a nudge back to the menu. */
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
    text("No encontré esa prenda 🔎. Dime el nombre como aparece en el catálogo, o escribe *menu*."),
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
