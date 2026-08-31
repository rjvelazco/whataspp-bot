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
