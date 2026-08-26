# FEEDBACK.md — Store Bot admin panel redesign

Instructions for Claude Code. Read this file and `PROTOTYPE.html` together before writing code.

---

## What this is

`PROTOTYPE.html` is a working visual reference for a redesign of the Store Bot admin
panel (WhatsApp bot for the store "Nova Moda"). It is a **spec, not a codebase.**

- It is one self-contained HTML file with vanilla JS and mock data.
- The real app is a Next.js app running at `localhost:3000` with routes under `/dashboard/*`.
- **Do not copy the prototype's JS architecture.** Copy its layout, spacing, tokens,
  component structure, copywriting, and interaction behavior.
- When the prototype and this document disagree, this document wins.

---

## Rules that apply to every task

1. **8-point grid.** Every margin, padding, gap, and fixed dimension is a multiple of 8.
   The only exceptions already in the prototype are hairline borders (1px, 1.5px),
   border radii, and optical nudges inside pills. No 12px, 20px, or 50px spacing.
2. **Strict alignment.** Controls in a toolbar share the left edge of the first cell of
   the table below them. In the prototype this is a shared 24px card inset. The current
   app is off by 12px in Pagos — that is the bug that started this whole review.
3. **Responsive first.** Two breakpoints: 960px (sidebar collapses to a top bar) and
   720px (tables restack into labelled cards). Test both before calling a task done.
4. **Never show database identifiers.** No `{direccion}`, `{store_name}`, `menu_principal`,
   or raw enum values anywhere in the UI. See "The token problem" below.
5. **Every tappable control has a visible boundary at rest.** Do not rely on hover to
   reveal that something is a button. There is no hover on mobile.

---

## Design system

Extract these into the Tailwind config (or a CSS variables file) as the first task.
They are defined at the top of `PROTOTYPE.html` under `:root`.

### Spacing
`--s1: 8px`, `--s2: 16px`, `--s3: 24px`, `--s4: 32px`, `--s5: 48px`, `--s6: 64px`

### Color

| Token | Value | Meaning — do not use decoratively |
|---|---|---|
| `--ink` | `#101A21` | Primary text |
| `--ink-2` | `#41585F` | Secondary text |
| `--ink-3` | `#7D9199` | Tertiary, placeholders, labels |
| `--line` | `#DCE4E1` | Borders |
| `--line-soft` | `#EAEFEC` | Internal dividers |
| `--paper` | `#FFFFFF` | Card surfaces |
| `--wash` | `#EEF2EE` | Page background |
| `--signal` | `#0A6C48` | **The bot, verified, confirmed, primary action** |
| `--signal-soft` | `#DCEEE3` | Emerald backgrounds |
| `--amber` | `#8F5300` | **Waiting on the user to act** |
| `--rose` | `#9E241B` | **Cancelled, destructive, error** |

Color carries meaning here. Emerald is never used just because something looks nice —
it means the bot handled it or a human verified it. The current app uses violet
generically; drop violet entirely.

### Type
- Display (headings, numbers in stat tiles): **Bricolage Grotesque**, 600–700
- Body: **Instrument Sans**, 400–600
- Data (IDs, money, times, codes, references): **DM Mono**, 400–500

All money and all counts use `font-variant-numeric: tabular-nums` so columns line up.

### Component conventions
- **Solid border** = acts on something that exists.
- **Dashed border** = creates something new. Used by "+ Agregar opción",
  "+ Agregar palabra", "Nueva historia" and "Nuevo menú" tiles. One rule, applied everywhere.
- **Ghost buttons** keep a hairline `--line-soft` border at rest. Reserved for
  Cancelar / Atrás / Desconectar.
- **Stat tiles** get a 3px colored left edge, not a colored background.

---

## The token problem

The bot's message templates genuinely need variable substitution, but users must never
see `{store_name}`. The prototype solves this in the Menús editor and you should reuse
that approach:

- **Storage layer:** unchanged. Messages are stored as `"¡Hola! Bienvenid@ a {tienda}."`
- **Editor:** a contenteditable field where each token renders as a non-editable emerald
  pill reading "Nombre de la tienda". Serialize pills back to `{tienda}` on save.
- **Everywhere else** (cards, previews, lists): resolve tokens to real values before render.
- **Insertion UI:** a row of dashed emerald chips labelled with the human name of each field.

See `toPills()`, `fromPills()` and `resolve()` in the prototype for reference logic.

---

## Tasks by view

### Phase 1 — Foundation

- [ ] Extract the design tokens above into the Tailwind config.
- [ ] Replace violet with emerald throughout; audit each usage for semantic correctness.
- [ ] Load the three fonts.
- [ ] Build the responsive shell: 256px sidebar → 960px top bar → 720px compact.
- [ ] Audit every spacing value in the app against the 8-point grid.

### Phase 2 — Pagos (`/dashboard/pagos`)

- [ ] **Fix the status bug.** The stat cards count payment status ("Por verificar" /
      "Confirmados") but the table's Estado column shows delivery status
      ("Entregado" / "Cancelado"). These are different things. Pagos shows **payment**
      status; delivery status belongs in Pedidos only.
- [ ] Reduce the desktop table to five columns: Recibo, Fecha, Cliente, Total, Pago.
      Drop the avatar. Keep the phone number as a small mono line under the name.
- [ ] Below 720px, reveal Artículos and Entrega as extra rows in the stacked card.
- [ ] Make rows clickable, opening a centered receipt popup with the full detail:
      method, reference, line items, delivery, and the comprobante image.
- [ ] Sortable column headers — click to sort, click again to reverse. Fecha and Total
      open descending; text columns open ascending.
- [ ] Sort Fecha on a real timestamp and Pago on a status rank, not on the display string.
- [ ] Add "Exportar a Excel". Use SheetJS; ten columns with explicit widths.
      See the `btnExport` handler for the column set.
- [ ] **Fix the broken comprobante thumbnails.** They currently render as broken-image
      icons in both Pagos and Pedidos. Investigate the image URL/serving path first.

**Open question for Rafael:** the comprobante thumbnail is no longer in the table, so
"did they send proof?" now requires a click. Consider folding it into the Pago badge as
a third state: Verificado / Por verificar / Sin comprobante. Ask before implementing.

### Phase 3 — Productos (`/dashboard/productos`)

- [ ] Add a search field filtering on name, code, and category.
- [ ] Sortable column headers on Producto, Código, Categoría, Precio, Stock.
      No separate "sort by" dropdown — the header is the control.
- [ ] Show the active sort as a small label in the toolbar ("Precio ↓").
- [ ] Stock badges: `0` → rose "Agotado"; `≤5` → amber "N quedan"; otherwise plain number.
- [ ] Rename the Activo column to "Visible en el bot" — it says what the toggle does.

### Phase 4 — Recursos (`/dashboard/recursos`)

- [ ] Rename the "Catálogo / Menú" section to **Archivos**.
- [ ] Delete the "Promociones / Flyers" section entirely.
- [ ] In "Historias / Estados", keep only **Estados**.
- [ ] **Generate thumbnails.** This page currently freezes the browser renderer —
      it is loading full-size images. This is a real performance bug, not a style issue.
- [ ] Build the 3-step story composer as a modal:
  - **Step 1** — upload one or more images/videos; removable thumbnails; Continue
    disabled until at least one file is added.
  - **Step 2** — caption, shown beside the media strip.
  - **Step 3** — schedule. Three mutually exclusive modes:
    `Todos los días` / `Días específicos` (weekday chips) / `Una sola vez` (date picker).
  - A time picker in all three modes, styled like the iOS/Android clock.
  - Checkbox "Borrar el archivo después de publicar", **disabled and unchecked unless
    `Una sola vez` is selected.** This conditional is the point of the step — do not skip it.
  - A plain-language summary line confirming the schedule before saving.
- [ ] Animate the step transition and the progress bar.

**npm packages:** `react-day-picker` for the calendar and `react-mobile-picker` (3KB) for
the wheel. Avoid `@mui/x-time-picker` — it drags in Material's styling.

### Phase 5 — Tienda (`/dashboard/tienda`)

- [ ] Remove the `{direccion}` / `{envios}` / `{tasa}` badges. Replace the label
      "El bot responde a:" with "Los clientes la piden escribiendo:" followed by
      editable keyword chips.
- [ ] Delete the right-hand "Secciones" list. Replace it with a horizontal tab rail
      above the form. It was consuming 320px to render five links.
- [ ] **Keep the bot preview** — it is the most useful thing on the page, because it is
      the only place you see what the customer actually receives. Move it into a
      right-side drawer behind a "Ver respuesta del bot" button.
- [ ] Rebuild the form as a 3-column grid. Size inputs to their content: a phone field
      does not need 900px. Use `max-width` on textareas.
- [ ] **Tasa del dólar** becomes a source dropdown with four options:
      `Dólar oficial`, `Dólar paralelo`, `Euro oficial`, `Personalizada`.
  - `Personalizada` reveals a second field for the user's own label.
  - The unit label follows the choice: "Bs. por $1" → "Bs. por €1" for Euro oficial.
  - Each option shows a one-line note saying whether it updates automatically.
  - Oficial and Euro should pull from BCV; the other two are manual.

### Phase 6 — Menús (`/dashboard/configuracion`)

- [ ] Rename the view from "Configuración" to **Menús**. "Configuración" describes where
      it lives in the code; "Menús" describes what the user edits.
- [ ] Remove the `menu_principal` / `menu_catalogo` code badges from the cards.
- [ ] Mark the starting menu with a "Primer mensaje" badge and an emerald left edge
      instead of a star plus a "5/5" counter that explains nothing.
- [ ] Card message previews resolve tokens to real values.
- [ ] Build the editor modal: name, message (with token pills), trigger word chips,
      a numbered option list with a plain-language action dropdown per option,
      and a live WhatsApp preview.
- [ ] Action dropdown values are written for humans: "Envía la lista de precios",
      not a handler name.
- [ ] Hide Delete on the starting menu — removing it would leave the bot mute.

---

## Known bugs found while inspecting the live app

1. **Pagos mixes payment status and delivery status.** Highest priority; it makes the
   stat cards contradict the table.
2. **Comprobante thumbnails are broken** in Pagos and Pedidos (broken-image icon).
3. **Recursos freezes the renderer** — full-size images, no thumbnails.
4. **Nothing is responsive.** At 790px the sidebar stays fixed and the table crushes.
5. **Spacing is off-grid** throughout: 12px, 20px, and 50px values are common.
6. **Ghost buttons are invisible at rest** — transparent border, no background, so the
   control reads as plain text until hover, and never reveals itself on touch.

---

## Definition of done for any task

- Renders correctly at 1440px, 900px, and 390px.
- No spacing value off the 8-point grid.
- No database identifier visible anywhere in the UI.
- Every interactive control has a visible boundary before interaction.
- Keyboard reachable, with `aria-sort` on sortable headers and `role="switch"` on toggles.
- Copy is in Spanish, plain language, addressed to a shop owner rather than a developer.
