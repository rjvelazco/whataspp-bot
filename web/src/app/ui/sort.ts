/** Which column a table is sorted by, and which way. */
export interface SortState<K extends string = string> {
  readonly key: K;
  readonly dir: 'asc' | 'desc';
}

/**
 * The next sort state after clicking a header.
 *
 * Clicking the active column reverses it; clicking a new one starts from that column's
 * natural direction. Numeric and date columns open descending, because "most recent" and
 * "largest" are what someone is looking for; text opens ascending.
 */
export function nextSort<K extends string>(
  current: SortState<K>,
  key: K,
  numeric: boolean,
): SortState<K> {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: numeric ? 'desc' : 'asc' };
}

/**
 * Sort by a caller-supplied value per row.
 *
 * The value must be the thing being compared, never the rendered string: sorting the
 * formatted date sorts "10 jul" before "1 jul", and sorting a status label orders it
 * alphabetically. Strings compare with Spanish collation so that á and ñ land where a
 * Spanish reader expects, and with `numeric` so "#9" precedes "#10".
 */
export function sortBy<T>(
  rows: readonly T[],
  value: (row: T) => string | number,
  dir: 'asc' | 'desc',
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (typeof x === 'string' || typeof y === 'string') {
      return (
        String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' }) * sign
      );
    }
    return (x - y) * sign;
  });
}

/**
 * The search-then-sort pipeline every list view runs.
 *
 * Extracted because both views had it near-verbatim, including the trim/lowercase
 * normalisation — and that is the part that can drift behaviourally, unlike the p-table
 * config. `text` returns the haystack for a row; `sortValue` maps a sort key to the value
 * being compared.
 */
export function filterAndSort<T, K extends string>(
  rows: readonly T[],
  query: string,
  sort: SortState<K>,
  text: (row: T) => string,
  sortValue: Record<K, (row: T) => string | number>,
): T[] {
  const q = normalize(query);
  const matched = q ? rows.filter((row) => normalize(text(row)).includes(q)) : rows;
  return sortBy(matched, sortValue[sort.key], sort.dir);
}

/**
 * Fold case and strip accents, so searching "basico" finds "Top Básico".
 *
 * A Spanish catalogue is full of accents that nobody types into a search box.
 */
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
