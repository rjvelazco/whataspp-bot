import type { ConvState, FlowMenu } from "../domain/types.js";
import type { Intent } from "./intents.js";
import { findMenuByTrigger } from "./handlers.js";

/** States where the customer is navigating menus (safe to jump via a trigger/keyword). */
export const NAV_STATES = new Set<ConvState>(["idle", "in_menu", "browsing", "checking_size"]);

/** Intents that interrupt from ANY state (escape hatches / global commands). */
export function isGlobalIntent(intent: Intent): boolean {
  return (
    intent.type === "talk_human" ||
    intent.type === "greeting" ||
    intent.type === "menu" ||
    intent.type === "size_guide" ||
    intent.type === "cancel"
  );
}

/** Informational keyword intents (rate, address, shipping, payment, offers, hours). */
export function isInfoIntent(intent: Intent): boolean {
  return (
    intent.type === "show_rate" ||
    intent.type === "show_address" ||
    intent.type === "show_shipping" ||
    intent.type === "show_payment" ||
    intent.type === "show_offers" ||
    intent.type === "hours"
  );
}

/** Where an incoming message is routed. `dispatch` covers numbered replies,
 *  order-code, in-order data entry, availability, and the fallback. */
export type Route =
  | { kind: "global" }
  | { kind: "info" }
  | { kind: "trigger"; menu: FlowMenu }
  | { kind: "dispatch" };

/**
 * The single source of routing precedence (pure + unit-testable):
 *   1. In-order data entry — anything below the global level only applies while
 *      navigating menus (NAV_STATES), so an order-entry answer is never hijacked.
 *   2. Global keywords — cancel / menu / greeting / human / size guide (any state).
 *   3. Informational keywords — tasa / dirección / envíos / pagos / ofertas / horario.
 *   4. Menu triggers — a message matching a menu's trigger jumps to it.
 *   5. Fallback — per-state dispatch (numbered reply, PEDIR, availability, "no entendí").
 */
export function resolveIncoming(intent: Intent, conv: { state: ConvState }, menus: FlowMenu[]): Route {
  if (isGlobalIntent(intent)) return { kind: "global" };

  const nav = NAV_STATES.has(conv.state);
  if (nav && isInfoIntent(intent)) return { kind: "info" };

  if (nav && intent.type === "text") {
    const menu = findMenuByTrigger(menus, intent.value);
    if (menu) return { kind: "trigger", menu };
  }

  return { kind: "dispatch" };
}
