import type { Row, SheetData } from 'write-excel-file/browser';
import { customerNumber, itemsSummary, paymentLabel, paymentState } from '../order-display';
import type { Order } from '../orders.service';

/**
 * The Pagos export, as a spreadsheet the owner can hand to an accountant.
 *
 * Eight columns, not the prototype's ten: the bot never captures a payment method or a
 * reference number, so Método and Referencia have nothing to put in them.
 *
 * The library is imported dynamically by the caller. It is only needed the moment someone
 * clicks Exportar, and eagerly importing it would put a spreadsheet writer into the
 * initial bundle that every page load pays for.
 */

/** Column headings, widths and how each cell is read off an order. */
const COLUMNS: {
  header: string;
  width: number;
  value: (order: Order) => string | number;
  align?: 'right';
}[] = [
  { header: 'Pedido', width: 10, value: (o) => `#${o.order_id}` },
  { header: 'Fecha', width: 20, value: (o) => formatDate(o.created_at) },
  { header: 'Cliente', width: 18, value: (o) => o.customer_name || 'Sin nombre' },
  { header: 'Teléfono', width: 20, value: (o) => customerNumber(o.customer_wa) },
  { header: 'Artículos', width: 42, value: (o) => itemsSummary(o) },
  { header: 'Total (USD)', width: 12, value: (o) => o.subtotal, align: 'right' },
  { header: 'Pago', width: 16, value: (o) => paymentLabel(paymentState(o)) },
  { header: 'Entrega', width: 30, value: (o) => o.delivery_address || 'A coordinar' },
];

/**
 * `2026-07-10T17:06:46Z` -> `10/07/2026 13:06`, in the reader's own timezone.
 *
 * Written out rather than handed to Excel as a date, because a real date cell is
 * reinterpreted by the reader's locale — the same file then shows July 10th to one
 * person and October 7th to another.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** A filename that sorts chronologically and says which store it came from. */
export function exportFilename(storeName: string, now: Date): string {
  const slug = storeName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `pagos-${slug || 'tienda'}-${stamp}.xlsx`;
}

/** The sheet as rows of cells, header row included. */
export function buildSheet(orders: readonly Order[]): SheetData {
  const header: Row = COLUMNS.map((c) => ({
    value: c.header,
    fontWeight: 'bold',
    ...(c.align ? { align: c.align } : {}),
  }));

  const body: Row[] = orders.map((order) =>
    COLUMNS.map((c) => {
      const value = c.value(order);
      const align = c.align ? { align: c.align } : {};
      return typeof value === 'number'
        ? { type: Number, value, format: '#,##0.00', ...align }
        : { type: String, value, ...align };
    }),
  );

  return [header, ...body];
}

export const columnWidths = COLUMNS.map((c) => ({ width: c.width }));
