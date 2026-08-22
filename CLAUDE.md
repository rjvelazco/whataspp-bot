# CLAUDE.md

Rules for working on this repo. They apply to AI agents and to people equally.
Long-form reference: [`docs/design-system.md`](docs/design-system.md).

## What this is

A reusable WhatsApp sales bot for clothing stores, plus an admin panel. Two npm packages,
one process:

- **`src/`** — the bot. TypeScript (ESM, Node 20+), [Baileys](https://github.com/WhiskeySockets/Baileys)
  for WhatsApp, `better-sqlite3` for storage, Express for the API in `src/web/server.ts`.
- **`web/`** — the admin panel (Angular project `store-admin`). Angular 20 standalone
  components + signals, PrimeNG 20, Tailwind v4 (CSS-first — there is no `tailwind.config`).

The Express server serves both the API and the built Angular bundle on port 3000. The bot
engine is transport-agnostic; Baileys is one adapter.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Bot + API + admin UI on http://localhost:3000 (file-watch) |
| `npm run lint` | ESLint + Stylelint + Prettier check. Must be green before any commit. |
| `npm run build` | Type-check only (`tsc --noEmit`) — emits nothing |
| `npm test` | Vitest (bot engine) |
| `npm run build:web` | Build the Angular bundle the server serves |
| `npm run format` | Apply Prettier — the fix for a failing `lint` |
| `npm start` | Run the bot once, without file-watch |
| `npm --prefix web start` | Angular dev server on :4200, proxying `/api` to :3000 |

`npm run lint` runs both packages and needs `web/`'s dependencies installed; run
`npm --prefix web install` once after cloning. For UI work run the bot with `npm run dev`
and the dev server with `npm --prefix web start` side by side: `web/proxy.conf.mjs` forwards
`/api` — including the `/api/events` SSE stream — from :4200 to :3000.

## Design rules

These are not preferences. A change that breaks one of them is wrong.

1. **8-point grid.** Every margin, padding, gap and fixed dimension is a multiple of 8. The
   only exceptions are hairline borders (1px, 1.5px), border radii, and optical nudges
   inside pills. No 12px, no 20px, no 50px.

   Stylelint enforces this on spacing properties in `.css` files. It does **not** see
   Tailwind utilities in templates — `gap-1.5`, `px-3` and `p-3` are off-grid and currently
   pass. Treat the rule as binding on you, not as covered by the linter.
2. **Strict alignment.** Toolbar controls and the first cell of the table beneath them share
   one left edge, taken from the shared card inset rather than re-specified per view. The
   `app-card` / `app-toolbar` components that own it arrive with the redesign foundation;
   until then, do not add a second source for that edge.
3. **Never show a database identifier.** Not `{store_name}`, not `menu_principal`, not a raw
   `OrderStatus` value, not a filesystem path, not an enum key. Message templates are
   *stored* with `{tokens}` and *rendered* as human-labelled pills; everywhere else they
   resolve to real values before display.
4. **Always use the design tokens.** No raw hex, `rgb()`, or one-off font stack outside the
   two token files (`web/src/styles.css` and `web/src/app/theme/app-preset.ts`). Colour
   carries meaning:
   - **emerald** — the bot handled it, or a human verified it
   - **amber** — waiting on the user to act
   - **rose** — cancelled, destructive, error

   Never pick a colour because it looks nice.
5. **Solid border = acts on something that exists. Dashed border = creates something new.**
   One rule, applied everywhere.
6. **Every tappable control has a visible boundary at rest.** Ghost buttons keep a hairline
   border. Do not rely on hover to reveal that something is a button — there is no hover on
   mobile.
7. **Money and counts use `tabular-nums`** so columns line up. Stat tiles get a 3px coloured
   left edge, never a tinted background.

## Responsive

Two breakpoints, and nothing else:

- **960px** — the sidebar rail collapses to a horizontal top bar.
- **720px** — tables restack into labelled cards.

A change is not done until it renders correctly at **1440px, 900px and 390px**.

## Angular conventions

- Standalone components and signals. No NgModules, no `zone.js` patterns in new code.
- **`computed()`, not method calls in templates.** A method in a template re-runs on every
  change-detection pass; `totalStock(it)` was being called twice per row per pass.
- **Reuse the PrimeNG primitive before hand-rolling.** Dialog, ConfirmDialog, Toast, Table,
  Button, ToggleSwitch, Select, SelectButton, InputText, InputNumber, Textarea, FileUpload,
  Tag, Chip, Message, Popover, Tooltip, Avatar, Image and ProgressSpinner are in use and
  themed. **Drawer and DatePicker ship with PrimeNG but are not used yet** — reach for them
  rather than hand-rolling an equivalent. `docs/design-system.md` has the inventory.
- `p-toast` and `p-confirmdialog` are mounted once in the dashboard shell. Inject
  `MessageService` / `ConfirmationService` and use them; do not add local hosts.
- **Shared types go through `web/src/app/api-types.ts`**, a type-only re-export of the bot's
  `src/domain/types.ts`. Never re-declare an API shape inside a service — that is what lets
  the UI and the bot drift.
- Surface API errors with `apiErrorMessage()` / `apiIssues()` from `web/src/app/api-error.ts`
  rather than casting the `HttpErrorResponse` body.

## Backend conventions

- **Store a bare filename, never an absolute path.** Rejoin with `config.uploadsDir` at
  serve time. `createAsset` / `listAssets` in `src/db/repositories.ts` are the pattern to
  copy; absolute paths break on every directory move, machine change and container rebuild,
  and they leak host paths to the browser through the API JSON.
- **Every filesystem use of a DB-sourced path goes through a containment helper**
  (`localPhotoPath()` in `src/web/server.ts` is the model). A bad row must never let us read
  or delete an arbitrary file.
- **Pick file extensions from a server-side allow-list keyed on mimetype**, never by
  splitting a client-supplied string.
- **`src/db/schema.sql` is `CREATE TABLE IF NOT EXISTS` only**, applied on every boot. A new
  *table* is fine. A new *column* silently no-ops against an existing database and needs an
  explicit `ALTER TABLE` guard in `src/db/index.ts`.
- Several tables index a field that also lives inside `data_json` (`orders.status`,
  `catalog_items.active`). A write must update **both**, or they disagree.
- Order status transitions go through `canTransition()` in `src/domain/orderStatus.ts`. Do
  not mutate `status` directly in a route.

## One source of truth

This repo has already shipped four drifted duplications:

- the Tienda keyword chips vs `src/engine/intents.ts`
- the `:root` custom properties vs `web/src/app/theme/app-preset.ts`
- the Tienda bot-preview strings vs the real builders in `src/engine/menus.ts`
- `ENTRY_TRIGGERS` in `configuracion.ts` vs `findEntryMenu()` in `src/engine/handlers.ts`

Before adding a constant, a label map, or a copy string, search for an existing one and
import it. If a value must be known in both packages, it belongs in `src/domain/` and
reaches the UI through `api-types.ts`.

## Copy

Spanish, plain language, addressed to a shop owner — not to a developer. Say what the
control does ("Visible en el bot"), not what the field is called ("Activo"). Bot-facing
message text lives in `src/engine/menus.ts`; never retype it in the UI for a preview.

## Accessibility baseline

`aria-sort` on sortable headers. `role="switch"` on toggles. `aria-modal` on dialogs. Every
control reachable and operable by keyboard, with a visible focus ring. Labels associated
with their inputs.

## Git

- **Conventional commit prefixes**, matching the existing history: `feat`, `fix`, `refactor`,
  `perf`, `docs`, `chore`, with an optional `(web)` scope.
- **Stacked PRs are merged strictly bottom-up.** Never merge a PR whose base branch is not
  already in `main`. Violating this orphaned 12 commits above `main` for six weeks: every PR
  targeted its parent and they were merged downward, while the one PR that targeted `main`
  merged first and took only a snapshot with it.
- Branch before committing if you are on `main`. Commit or push only when asked.

## Before claiming something works

Run `npm run lint`, `npm run build` and `npm test`. Check the view in a browser at all three
widths. Report failures with their output — never describe work as done, fixed or passing
without having run the thing that proves it.
