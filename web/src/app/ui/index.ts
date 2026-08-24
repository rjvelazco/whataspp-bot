/**
 * The app's own UI primitives. Extract into this folder rather than pasting a third
 * instance of a pattern; see ../../../docs/design-system.md.
 *
 * Deliberately not here yet, because nothing consumes it: an editable keyword-chip row,
 * which arrives with Tienda. Building it before its first caller would be guessing at
 * the interface.
 */
export { PageHead } from './page-head';
export { StatCard, type StatTone } from './stat-card';
export { StatRow } from './stat-row';
export { Card } from './card';
export { Toolbar } from './toolbar';
export { SortableTh } from './sortable-th';
export { nextSort, sortBy, type SortState } from './sort';
export { DataTable } from './data-table';
export { TableSearch } from './table-search';
export { TableState } from './table-state';
