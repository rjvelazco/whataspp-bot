/** At or below this many units, the table warns instead of showing a bare count. */
export const LOW_STOCK = 5;

/** How the Stock column should read. */
export type StockLevel = 'out' | 'low' | 'ok';

/**
 * Total units across a product's variants, and what that total means.
 *
 * Stock lives only per-variant — there is no column for it — so this is the only place
 * the total is computed. It used to be a template method called twice per row per
 * change-detection pass, once for the value and once for the class.
 */
export function stockOf(variants: readonly { stock: number }[]): {
  stock: number;
  level: StockLevel;
} {
  // Clamped at zero: the API already refuses negative writes, but a bad row would
  // otherwise render "-3 quedan".
  const stock = Math.max(
    0,
    variants.reduce((n, v) => n + (Number(v.stock) || 0), 0),
  );
  return { stock, level: stock === 0 ? 'out' : stock <= LOW_STOCK ? 'low' : 'ok' };
}
