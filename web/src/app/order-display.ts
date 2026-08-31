import type { Order, OrderStatus } from './orders.service';

/** An order counts as "verified" once the owner has confirmed the payment. */
export function isVerified(order: Order): boolean {
  return order.status === 'confirmed' || order.status === 'shipped' || order.status === 'delivered';
}

/**
 * Where an order stands on **payment**, which is the only question Pagos asks.
 *
 * There is no payment_status column: one OrderStatus enum carries both the payment and
 * the fulfilment lifecycle, hinged on `confirmed`. That overloading is why Pagos was
 * wrong — its stat cards counted payment states while its Estado column showed delivery
 * states, so the cards contradicted the table. Deriving the payment axis needs no schema
 * change and no migration.
 *
 * `cancelado` is its own state rather than being folded into the others. Cancelling
 * overwrites `status` while leaving `receipt_url` in place, so a cancelled order is not
 * derivably paid *or* unpaid — and calling it "Por verificar" would put an amber badge
 * and a card count on something the owner cannot act on, next to an empty action cell.
 * It is excluded from all three cards, which is why the cards sum to the live rows rather
 * than to every row.
 *
 * This function is the single source: the badge, the three cards, the filter chips and
 * the sidebar's amber pill all derive from it. They used to disagree — the cards keyed on
 * `status === 'payment_submitted'` while the badge keyed on "unverified with a receipt",
 * which differ for exactly the cancelled case.
 */
export type PaymentState = 'verificado' | 'por_verificar' | 'sin_comprobante' | 'cancelado';

export function paymentState(order: Order, hasReceipt = !!order.receipt_url): PaymentState {
  if (order.status === 'cancelled') return 'cancelado';
  if (isVerified(order)) return 'verificado';
  return hasReceipt ? 'por_verificar' : 'sin_comprobante';
}

const PAYMENT_LABEL: Record<PaymentState, string> = {
  verificado: 'Verificado',
  por_verificar: 'Por verificar',
  sin_comprobante: 'Sin comprobante',
  cancelado: 'Anulado',
};

export function paymentLabel(state: PaymentState): string {
  return PAYMENT_LABEL[state];
}

/**
 * Sort rank for the Pago column: what needs acting on first, then what is merely
 * missing, then what is finished, then what is closed. Sorting the rendered label would
 * order these alphabetically, which is meaningless.
 */
const PAYMENT_RANK: Record<PaymentState, number> = {
  por_verificar: 0,
  sin_comprobante: 1,
  verificado: 2,
  cancelado: 3,
};

export function paymentRank(order: Order): number {
  return PAYMENT_RANK[paymentState(order)];
}

/** Labels only — the colour for a status lives in StatusTag, as its single source. */
const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Esperando pago',
  payment_submitted: 'Por verificar',
  confirmed: 'Confirmado',
  shipped: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export function statusLabel(status: OrderStatus): string {
  return STATUS_LABEL[status];
}

export function itemsSummary(order: Order): string {
  return order.items.map((i) => `${i.name || i.code} ${i.size}/${i.color} ×${i.qty}`).join(', ');
}

/** Format a WhatsApp id into a readable phone number, e.g. +58 414 555 0172. */
export function customerNumber(wa: string): string {
  const digits = wa.replace(/\D/g, '');
  // Venezuela: 58 + 10 digits.
  if (digits.startsWith('58') && digits.length === 12) {
    const n = digits.slice(2);
    return `+58 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  // Generic: country code (2–3 digits) + groups of 3.
  if (digits.length >= 8 && digits.length <= 15) {
    const cc = digits.length > 11 ? digits.slice(0, 3) : digits.slice(0, 2);
    const rest = digits.slice(cc.length).replace(/(\d{3})(?=\d)/g, '$1 ');
    return `+${cc} ${rest}`;
  }
  return '+' + digits;
}

/** wa.me deep link so the owner can message the customer directly. */
export function waLink(wa: string): string {
  return 'https://wa.me/' + wa.replace(/\D/g, '').replace(/^0+/, '');
}
