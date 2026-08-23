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
 * clicks Exportar, and importing it eagerly would put a spreadsheet writer into the
 * bundle that every page load pays for.
 */

/** Excel's own date format, so day-before-month is fixed in the file. */
const DATE_FORMAT = 'dd/mm/yyyy hh:mm';

/** How each column is titled, sized, and read off an order. */
interface Column {
  header: string;
  width: number;
  cell: (order: Order) => Row[number];
  /** Headers over numbers sit right; Excel already right-aligns the numbers themselves. */
  alignHeader?: 'right';
}

const COLUMNS: Column[] = [
  { header: 'Pedido', width: 10, cell: (o) => text(`#${o.order_id}`) },
  { header: 'Fecha', width: 20, cell: (o) => date(o.created_at) },
  { header: 'Cliente', width: 18, cell: (o) => text(o.customer_name || 'Sin nombre') },
  // A string, not a number: a numeric cell would eat the leading +.
  { header: 'Teléfono', width: 20, cell: (o) => text(customerNumber(o.customer_wa)) },
  { header: 'Artículos', width: 42, cell: (o) => text(itemsSummary(o)) },
  {
    header: 'Total (USD)',
    width: 12,
    alignHeader: 'right',
    // Numeric, so it still sums and filters in a spreadsheet.
    cell: (o) => ({ type: Number, value: o.subtotal ?? 0, format: '#,##0.00' }),
  },
  { header: 'Pago', width: 16, cell: (o) => text(paymentLabel(paymentState(o))) },
  { header: 'Entrega', width: 30, cell: (o) => text(o.delivery_address || 'A coordinar') },
];

const text = (value: string): Row[number] => ({ type: String, value });

/**
 * A real Excel date cell, not text.
 *
 * A date cell carries an explicit number format, so dd/mm ordering is fixed in the file
 * rather than re-derived from whoever opens it — and unlike text it stays sortable and
 * date-filterable, which is the whole reason someone opens this in Excel.
 *
 * The offset shift is required: write-excel-file converts a Date with a bare
 * `getTime() / msPerDay`, with no timezone compensation, so passing the Date as-is would
 * render every timestamp in UTC. Shifting by the local offset makes the serial number
 * mean the same wall-clock reading the admin panel shows.
 */
function date(iso: string | null | undefined): Row[number] {
  if (!iso) return text('');
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return text(String(iso));
  const localised = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return { type: Date, value: localised, format: DATE_FORMAT };
}

/** Longest filename the common filesystems accept is 255 bytes; leave room to spare. */
const MAX_SLUG = 40;

/** A filename that sorts chronologically and says which store it came from. */
export function exportFilename(storeName: string, now: Date): string {
  const slug = storeName
    .toLowerCase()
    .normalize('NFD')
    // Escaped rather than written literally: a bare combining-marks range is two
    // invisible characters in the source, which an editor or a paste can silently mangle.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG)
    .replace(/^-|-$/g, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  // Local date, matching the owner's calendar day and the dates inside the file.
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `pagos-${slug || 'tienda'}-${stamp}.xlsx`;
}

/** The sheet as rows of cells, header row included. */
export function buildSheet(orders: readonly Order[]): SheetData {
  const header: Row = COLUMNS.map((c) => ({
    value: c.header,
    fontWeight: 'bold',
    ...(c.alignHeader ? { align: c.alignHeader } : {}),
  }));
  return [header, ...orders.map((order) => COLUMNS.map((c) => c.cell(order)))];
}

/** The library's `columns` option: widths only. */
export const sheetColumns = COLUMNS.map((c) => ({ width: c.width }));
