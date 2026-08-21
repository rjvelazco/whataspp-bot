import type { Order, OrderStatus } from './orders.service';

/** An order counts as "verified" once the owner has confirmed the payment. */
export function isVerified(order: Order): boolean {
  return order.status === 'confirmed' || order.status === 'shipped' || order.status === 'delivered';
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
