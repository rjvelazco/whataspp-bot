# Design system

Long-form companion to the rules in [`CLAUDE.md`](../CLAUDE.md). This document explains
*why* and *where*; `CLAUDE.md` is the short list of what you must do.

**This file names files, never values.** Restating a hex code or a font stack in prose is
exactly how this repo produced four drifted duplications. If you want to know what
`--color-signal` is, open the file that defines it.

---

## Where a token is defined

Two files, and only two:

| File | Owns |
|---|---|
| `web/src/styles.css` | The Tailwind v4 `@theme` block, exposed as utility classes. Also the `@layer` order and the app shell. Today it defines only the status colours; the full palette, the font families, radii, shadow and focus ring arrive with the redesign foundation. |
| `web/src/app/theme/app-preset.ts` | The PrimeNG preset (`definePreset(Aura, …)`) — the `primary` ramp and the `surface` ramp. |

These two are not independent. The `tailwindcss-primeui` plugin derives the Tailwind
`*-primary-*` and `*-surface-*` utilities from the PrimeNG preset, so **editing
`app-preset.ts` retints PrimeNG components and Tailwind utilities at the same time.** That is
why a re-theme is a small diff rather than a sweep through every template.

The layer order declared at the top of `styles.css` — `theme, base, primeng, components,
utilities` — is what lets a Tailwind utility class win over a PrimeNG component default. It
is mirrored in the `cssLayer` option passed to `providePrimeNG()` in `app.config.ts`. Change
one and you must change the other.

Dark mode is deliberately off: `darkModeSelector` points at a class that is never applied.
The admin is light-only.

## What the colours mean

Colour is semantic here, not decorative. Three roles, and a change that uses one of them for
a different purpose is a bug even if it looks fine:

- **emerald** — the bot handled it, or a human verified it. Confirmed payments, active
  toggles, the primary action, "Bot conectado".
- **amber** — waiting on the user to act. "Por verificar", low stock, an unwired menu option.
- **rose** — cancelled, destructive, error. "Agotado", "Cancelado", delete actions.

Neutrals carry the rest: ink for text at three weights, line and line-soft for borders and
internal dividers, paper for card surfaces, wash for the page background.

## Spacing

An 8-point grid, exposed as the token scale. Every margin, padding, gap and fixed dimension
is a multiple of 8. Three exceptions, and no others:

- hairline borders (1px, 1.5px)
- border radii
- optical nudges inside pills, where 8 would look wrong

Stylelint enforces this on the `padding`, `margin` and `gap` properties (shorthands and
longhands) inside `.css` files. If you genuinely need an off-grid value, the disable comment
must say why.

Stylelint only sees `.css` files, and the views are pure Tailwind — their stylesheets are
28-byte stubs. So the class names carry every real spacing decision, and
`web/scripts/check-spacing-utilities.mjs` checks those. Tailwind steps are n x 4px, which
makes the rule simple: **zero and even steps are on the grid, everything else is not.**

It is a ratchet rather than a wall. `web/spacing-baseline.json` budgets the 128 off-grid
utilities that exist today across 7 templates — sweeping them all at once would mean
rewriting every view in one commit. A file over budget fails; so does a file whose debt drops
without its budget following, which stops the ratchet slipping. Each PR that restyles a view
lowers its entry, and the one that reaches zero deletes it.

Once every entry is gone, the scale itself can be narrowed in `@theme` so an off-grid utility
simply fails to generate. Until then the checker is what holds the line.

### The alignment rule

Controls in a toolbar share the left edge of the first cell of the table below them. Both
derive that edge from the shared card inset, owned by `app-card` / `app-toolbar` in
`web/src/app/ui/`.

This is not cosmetic pedantry — it is the bug that started the redesign. Pagos was 12px out
because the toolbar padding and the table cell padding were specified separately in two
places. Deriving both from one component is the fix; re-specifying either per view
reintroduces the bug.

## Typography

Three faces, each with a job:

- **Display** — headings and the numbers in stat tiles.
- **Body** — everything else.
- **Data** — IDs, money, times, codes, references. Anything the reader compares column to
  column, or copies.

**Not yet true in the code:** no web fonts are loaded at all. Typography is still the system
stack, declared twice — once as `--font-sans` in `styles.css` and again, duplicated verbatim,
in `web/src/app/app.css`. The three families and the `index.html` link arrive with the
redesign foundation, which also deletes that duplicate.

All money and all counts set `tabular-nums` so digits align vertically.

## Component conventions

- **Solid border** — this control acts on something that already exists.
- **Dashed border** — this control creates something new. "+ Agregar opción", "+ Agregar
  palabra", the "Nueva historia" and "Nuevo menú" tiles.
- **Ghost buttons** keep a hairline border at rest. Reserved for Cancelar / Atrás /
  Desconectar. A ghost button with a transparent border reads as plain text and never
  reveals itself on a touch screen.
- **Stat tiles** get a 3px coloured left edge, not a tinted background.
- **Sortable headers** are buttons, own their `aria-sort`, and sort on a real value — a
  timestamp or a rank — never on the rendered display string.

## Shared components

Today there is exactly **one** app-owned UI component: `app-status-tag`, at
`web/src/app/status-tag/`. It wraps `p-tag`; its labels live in `order-display.ts` and its
colour map lives in the component, and that split is the convention to preserve.

`web/src/app/ui/` **does not exist yet.** The redesign foundation creates it with the
primitives below, extracted from patterns currently copy-pasted across views. Once it exists,
extract into it rather than pasting a third instance of anything.

| Component | Purpose |
|---|---|
| `app-page-head` | Eyebrow, title, lede, actions slot |
| `app-stat-card` | Label, value, note, tone — the 3px left edge |
| `app-card` / `app-toolbar` | The card surface and the shared inset that owns the alignment rule |
| `app-sortable-th` | Button-wrapped header, sort arrows, `aria-sort` |
| `app-keyword-chips` | Editable chip row |

## PrimeNG primitives already wired

Reuse these before hand-rolling anything. All are themed by the preset, so they need no
per-use styling:

**In use today:** `p-dialog` (including a working nested-dialog pattern in the menu editor) ·
`p-confirmdialog` + `ConfirmationService` · `p-toast` + `MessageService` · `p-table` ·
`p-button` · `p-toggleswitch` · `p-select` · `p-selectbutton` · `pInputText` ·
`p-inputnumber` · `pTextarea` · `p-fileupload` · `p-tag` · `p-chip` · `p-message` ·
`p-popover` · `pTooltip` · `p-avatar` · `p-image` · `p-progressspinner` · CDK `drag-drop`.

**Available but not yet wired:** `p-drawer` and `p-datepicker`. Both ship with the installed
PrimeNG and are themed by the preset — reach for them rather than hand-rolling an
equivalent.

`p-toast` and `p-confirmdialog` are mounted once in the dashboard shell — inject the service,
do not add another host.

**Known gap:** PrimeNG has no scroll-snap wheel picker, and no maintained Angular 20 package
provides one. The hour/minute picker is hand-rolled with `scroll-snap-type: y mandatory`;
`p-datepicker` still handles date selection, where its calendar is the right control.

## Responsive

Two breakpoints:

- **960px** — the 256px sidebar rail becomes a sticky horizontal top bar. Nav labels collapse
  to icons except the active item.
- **720px** — tables restack into labelled cards, using a `data-l` attribute per cell for the
  row label. Columns that only earn their space on a small screen appear here.

Check 1440px, 900px and 390px. There is no third breakpoint; if a layout needs one, the
layout is wrong.

## Copy

Spanish, plain language, addressed to a shop owner rather than a developer.

- Name what the control **does**, not what the column is called: "Visible en el bot", not
  "Activo".
- Never surface an internal identifier. A menu's key, an order's raw status, a token name and
  a file path are all implementation details.
- Bot-facing message text lives in `src/engine/menus.ts`. A preview must call those builders.
  The Tienda preview was hand-retyped and had already drifted from what the bot actually
  sends — do not repeat that.

## Accessibility

The floor, not the ceiling:

- `aria-sort` on every sortable header, updated as the sort changes.
- `role="switch"` on every toggle.
- `aria-modal` and a focus trap on every dialog; Escape closes.
- Every control reachable and operable by keyboard, with a visible focus ring drawn from the
  ring token.
- Labels associated with their inputs.

`angular-eslint`'s template rules check the mechanical parts. They do not check that a
keyboard user can actually complete the task — do that by hand.
