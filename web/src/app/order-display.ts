import type { Order, OrderStatus } from './orders.service';

export type Severity = 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast';

/** An order counts as "verified" once the owner has confirmed the payment. */
export function isVerified(order: Order): boolean {
  return order.status === 'confirmed' || order.status === 'shipped' || order.status === 'delivered';
}

const STATUS_META: Record<OrderStatus, { label: string; severity: Severity }> = {
  pending_payment: { label: 'Esperando pago', severity: 'secondary' },
  payment_submitted: { label: 'Por verificar', severity: 'warn' },
  confirmed: { label: 'Confirmado', severity: 'info' },
  shipped: { label: 'En camino', severity: 'contrast' },
  delivered: { label: 'Entregado', severity: 'success' },
  cancelled: { label: 'Cancelado', severity: 'danger' },
};

export function statusLabel(status: OrderStatus): string {
  return STATUS_META[status].label;
}
export function statusSeverity(status: OrderStatus): Severity {
  return STATUS_META[status].severity;
}

export function itemsSummary(order: Order): string {
  return order.items.map((i) => `${i.name || i.code} ${i.size}/${i.color} ×${i.qty}`).join(', ');
}

export function customerNumber(wa: string): string {
  return '+' + wa.replace(/[:@].*$/, '');
}

/** wa.me deep link so the owner can message the customer directly. */
export function waLink(wa: string): string {
  return 'https://wa.me/' + wa.replace(/\D/g, '').replace(/^0+/, '');
}
