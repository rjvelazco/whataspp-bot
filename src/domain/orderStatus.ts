import type { OrderStatus } from "./types.js";

/**
 * The legal order lifecycle, in one place. Every status change goes through
 * canTransition, so a route can't quietly resurrect a finished order (verifying
 * a delivered one used to be accepted, and told the customer their payment had
 * just been confirmed).
 */
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["payment_submitted", "confirmed", "cancelled"],
  payment_submitted: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** What a status may move to next — for error messages and the admin UI. */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ALLOWED[from];
}
