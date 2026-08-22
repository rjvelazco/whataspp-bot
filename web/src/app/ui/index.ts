/**
 * The app's own UI primitives. Extract into this folder rather than pasting a third
 * instance of a pattern; see ../../../docs/design-system.md.
 *
 * Deliberately not here yet, because nothing consumes them: a sortable table header
 * (arrives with the Pagos sorting work) and an editable keyword-chip row (arrives with
 * Tienda). Building either before its first caller would be guessing at the interface.
 */
export { PageHead } from './page-head';
export { StatCard, type StatTone } from './stat-card';
export { StatRow } from './stat-row';
export { Card } from './card';
export { Toolbar } from './toolbar';
