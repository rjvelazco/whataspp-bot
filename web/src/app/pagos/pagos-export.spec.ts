import { describe, expect, it } from 'vitest';
import { buildSheet, exportFilename, sheetColumns } from './pagos-export';
import type { Order } from '../orders.service';

const order = (over: Partial<Order> = {}): Order => ({
  order_id: '1009',
  store_id: 'novamoda',
  customer_wa: '584149682817@s.whatsapp.net',
  customer_name: 'Adrian',
  items: [{ code: 'TOPBASICO', name: 'Top Básico', size: 'M', color: 'blanco', qty: 1, price: 12 }],
  delivery_address: 'C.C. Costa Verde',
  subtotal: 12,
  status: 'payment_submitted',
  receipt_url: 'receipt-1009.jpg',
  created_at: '2026-07-10T17:06:46.228Z',
  ...over,
});

describe('buildSheet', () => {
  it('writes a bold header row matching the column count', () => {
    const [header] = buildSheet([]);
    expect(header).toHaveLength(sheetColumns.length);
    expect(header.map((c) => (c as { value: string }).value)).toEqual([
      'Pedido',
      'Fecha',
      'Cliente',
      'Teléfono',
      'Artículos',
      'Total (USD)',
      'Pago',
      'Entrega',
    ]);
    expect(header.every((c) => (c as { fontWeight?: string }).fontWeight === 'bold')).toBe(true);
  });

  it('writes money as a number, so it still sums in a spreadsheet', () => {
    const [, row] = buildSheet([order({ subtotal: 1234.5 })]);
    expect(row[5]).toEqual({ type: Number, value: 1234.5, format: '#,##0.00' });
  });

  it('writes the date as a real date cell, shifted so it reads as local wall-clock time', () => {
    // A text date cannot be sorted or date-filtered, which is the point of a spreadsheet.
    // The library converts with a bare getTime()/msPerDay, so without the offset shift
    // every timestamp would render in UTC.
    const [, row] = buildSheet([order({ created_at: '2026-07-10T17:06:00.000Z' })]);
    const cell = row[1] as { type: unknown; value: Date; format: string };
    expect(cell.type).toBe(Date);
    expect(cell.format).toBe('dd/mm/yyyy hh:mm');
    const source = new Date('2026-07-10T17:06:00.000Z');
    expect(cell.value.getTime()).toBe(source.getTime() - source.getTimezoneOffset() * 60_000);
  });

  it('keeps the phone as text, so the leading + survives', () => {
    const [, row] = buildSheet([order()]);
    expect(row[3]).toEqual({ type: String, value: '+58 414 968 2817' });
  });

  it('falls back rather than throwing on the degenerate rows', () => {
    const [, row] = buildSheet([
      order({ customer_name: '', delivery_address: '', items: [], subtotal: null as never }),
    ]);
    expect(row[2]).toEqual({ type: String, value: 'Sin nombre' });
    expect(row[4]).toEqual({ type: String, value: '' });
    expect(row[5]).toEqual({ type: Number, value: 0, format: '#,##0.00' });
    expect(row[7]).toEqual({ type: String, value: 'A coordinar' });
  });

  it('writes an empty cell for a missing date rather than the epoch', () => {
    // new Date(null) is the epoch, so an unguarded null printed 31/12/1969.
    const [, row] = buildSheet([order({ created_at: null as never })]);
    expect(row[1]).toEqual({ type: String, value: '' });
  });

  it('keeps an unparseable date visible instead of silently blanking it', () => {
    const [, row] = buildSheet([order({ created_at: 'not-a-date' })]);
    expect(row[1]).toEqual({ type: String, value: 'not-a-date' });
  });

  it('emits one row per order, after the header', () => {
    expect(buildSheet([order(), order({ order_id: '1010' })])).toHaveLength(3);
  });
});

describe('exportFilename', () => {
  const day = new Date(2026, 7, 23, 14, 30);

  it('slugifies the store name and stamps the local date', () => {
    expect(exportFilename('Nova Moda', day)).toBe('pagos-nova-moda-2026-08-23.xlsx');
  });

  it('strips accents rather than dropping the letters', () => {
    expect(exportFilename('Boutique Ángel', day)).toBe('pagos-boutique-angel-2026-08-23.xlsx');
    expect(exportFilename('Tienda Ñoño & Cía.', day)).toBe('pagos-tienda-nono-cia-2026-08-23.xlsx');
  });

  it('falls back to "tienda" when nothing survives the slug', () => {
    for (const name of ['', '   ', '---', 'Магазин', '店']) {
      expect(exportFilename(name, day)).toBe('pagos-tienda-2026-08-23.xlsx');
    }
  });

  it('caps the slug, so a long store name cannot exceed the filesystem limit', () => {
    // PUT /api/store only trims store_name; nothing bounds its length.
    const name = exportFilename('A'.repeat(300), day);
    expect(name.length).toBeLessThan(80);
    expect(name.endsWith('-2026-08-23.xlsx')).toBe(true);
    expect(name).not.toContain('--');
  });
});
