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
cp .env.example .env        # set STORE_ID (default: novamoda)
npm run dev                 # prints a QR code in the terminal
```

Scan the QR with the WhatsApp account that will *be* the bot (use a throwaway/non-critical number —
Baileys is unofficial and carries a small ban risk). Then message that number from another phone.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with file-watch + QR pairing |
| `npm start` | Run once (production-style) |
| `npm run build` | Type-check the project |
| `npm test` | Run the state-machine unit tests |

## Onboarding a new store

1. Copy `src/data/novamoda.store.json` and `src/data/novamoda.catalog.json`, rename to your store id.
2. Fill in the store config + catalog (shapes documented in `whatsapp-store-bot-mvp-spec.md` §3).
3. Set `STORE_ID` in `.env` and restart. No code changes.

> Detailed setup (pairing, flows, multi-store notes) is filled in through Phase 6.
