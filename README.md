# WhatsApp Store Bot

A reusable WhatsApp sales bot for clothing stores. **Generic engine + per-store config** —
onboarding a new store means editing JSON, not code.

Pilot transport is [Baileys](https://github.com/WhiskeySockets/Baileys) (pairs to a real WhatsApp
number via QR, no Meta approval). The engine is transport-agnostic, so the official Meta Cloud API
can be added later as a new adapter without touching the bot logic.

## Stack

- **TypeScript** (Node 20+, ESM)
- **Baileys** for WhatsApp
- **better-sqlite3** for storage, local `uploads/` for receipt photos

## Quick start

```bash
npm install
npm run build:web           # build the Angular web UI (first run / after UI changes)
cp .env.example .env        # set STORE_ID (default: novamoda)
npm run dev                 # starts the bot + web UI on http://localhost:3000
```

Open **http://localhost:3000** and scan the QR shown there with the WhatsApp account that will *be*
the bot (use a throwaway/non-critical number — Baileys is unofficial and carries a small ban risk).
The QR also prints in the terminal as a fallback. Once linked, the page shows **✅ Conectado**. Then
message that number from another phone.

> Prefer pairing by code instead of QR? Set `PAIR_PHONE` in `.env` (see comments there).

## Web UI

A small Angular app (in `web/`) runs on the same Node process as the bot:

- **Now:** live QR pairing / connection status, streamed over Server-Sent Events (`/api/events`).
- **Planned:** a payments dashboard — list orders with receipt photos and a "verify payment" button.

Build it with `npm run build:web`; the bot serves the built files. For live UI development you can run
`npm --prefix web start` (Angular dev server on :4200) alongside the bot — proxy `/api` to :3000.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with file-watch + QR pairing |
| `npm start` | Run once (production-style) |
| `npm run build` | Type-check the project |
| `npm run build:web` | Build the Angular web UI |
| `npm test` | Run the state-machine unit tests |

## Onboarding a new store

1. Copy `src/data/novamoda.store.json` and `src/data/novamoda.catalog.json`, rename to your store id.
2. Fill in the store config + catalog (shapes documented in `whatsapp-store-bot-mvp-spec.md` §3).
3. Set `STORE_ID` in `.env` and restart. No code changes.

## Conversation flows

All menus are **numbered** (Baileys can't render WhatsApp's tappable buttons). The customer replies
with a number *or* a keyword.

- **Greeting** — `hola` / `menu` / `inicio` → main menu.
- **Browse** — option 1 → pick a category → image cards with price, sizes, colors, and a `PEDIR <código>`.
- **Availability** — option 2, or just ask naturally (*"¿tienen el vestido bohemio en M?"*). Answers are
  variant-exact: M/negro can be sold out while M/beige is in stock.
- **Size guide** — `medidas` anytime.
- **Order** — `PEDIR <código>` → size → color → quantity → name → address → `confirmar`. Creates an
  order with status `pending_payment`.
- **Payment** — after confirming, the bot shows payment options; the customer sends a **photo** of the
  receipt → saved to `uploads/`, order becomes `payment_submitted`, **owner is notified**.
- **Human handoff** — `hablar con alguien` → owner is notified and the bot goes quiet for that customer
  for `HANDOFF_PAUSE_HOURS`. The customer can re-summon it with `menu`.

## How it's built

The bot brain (`src/engine/stateMachine.ts`) is a **pure function**: `(conversation, message, store,
catalog) → { replies, nextState, effects }`. It performs no IO — `src/index.ts` reads/writes SQLite and
talks to WhatsApp around it. That's why the whole thing is unit-tested with no WhatsApp connection
(`npm test`), and why swapping Baileys for the official Cloud API later is a new file under
`src/transport/`, not a rewrite.

| Layer | Files |
|---|---|
| Transport seam | `src/transport/types.ts`, `src/transport/baileys.ts` |
| Engine (pure) | `src/engine/*` — `stateMachine`, `handlers`, `order`, `catalog`, `payment`, `intents`, `menus` |
| Data | `src/db/*`, `src/services/seed.ts`, `src/data/*.json` |
| Wiring | `src/index.ts` |

## Configuration

Copy `.env.example` → `.env`. Key vars: `STORE_ID`, `DB_PATH`, `AUTH_DIR`, `UPLOADS_DIR`,
`HANDOFF_PAUSE_HOURS`. Per-store **content** lives in `src/data/<storeId>.store.json` and
`src/data/<storeId>.catalog.json` (shapes documented in `whatsapp-store-bot-mvp-spec.md` §3).

## Notes

- **Always-on:** the process must keep running (your machine, a small VPS, or Railway Hobby). If it
  restarts, it re-pairs automatically from the saved `auth/` credentials — no re-scan needed.
- **Multi-store:** one Baileys process serves one number/store. The `resolveStore()` seam
  (`src/stores/routing.ts`) is where Cloud API routing by `phone_number_id` plugs in to serve many
  stores from one deployment.
- **ToS / ban risk:** Baileys is unofficial — pilot on a non-critical number. Migrate to the official
  Cloud API before selling to clients.
