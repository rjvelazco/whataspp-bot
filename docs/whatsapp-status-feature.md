# WhatsApp Status (Estados) — daily auto-post

**Status:** ✅ Working — with one inherent reach limit. The Status displays for recipients who are
real phone contacts **and have the store's number saved**. The earlier "nothing shows" bug was an
**audience problem**, now fixed.

## Live finding (2026-07-05) — it was the audience, not the mechanism
Diagnosed and then confirmed working on the pilot number:
- Posting to a **self-only** or **`@lid`** audience returns `{reason:"ok"}` but **never displays** —
  WhatsApp silently drops it (matches Baileys issues
  [#2084](https://github.com/WhiskeySockets/Baileys/issues/2084),
  [#2503](https://github.com/WhiskeySockets/Baileys/issues/2503)).
- Posting an image + text Status to a **real customer's phone jid** (`58…@s.whatsapp.net`) who has
  the store saved → **displayed correctly** on their phone. ✅

**Root cause:** we stored customers by their `@lid` id (what `remoteJid` now carries), and `@lid`
jids are rejected as Status recipients. The real phone jid arrives alongside as `msg.key.senderPn`.

**Fixes (committed):**
- `toIncoming` prefers `msg.key.senderPn` → customers are keyed on a `@s.whatsapp.net` phone jid.
- Status audience = the bot's own jid + phone-jid customers, with legacy `@lid` entries filtered out.
- `onWhatsApp(number)` returns `{ jid, exists, lid }` — the phone↔lid mapping, if we ever need to
  backfill old `@lid` rows.

## Audience is a snapshot at post time (operational gotcha)
A Status reaches only the numbers in the audience **at the moment it is posted**. A customer who
first messages the bot *after* a post won't be in that post — they're picked up on the next one.
So the daily 22:15 post includes everyone registered by 22:15. Both text and image Status render
correctly (verified 2026-07-06); an earlier "can't see it" was just this timing effect.

## Reach limit (WhatsApp rule, not our code)
A Status only shows to recipients who **have the store's number saved as a contact**. Customers who
messaged but never saved the number won't see it. Existing `@lid`-only customers won't be reached
until they message again (then `senderPn` records their phone jid). If broader/guaranteed reach is
needed, a scheduled **direct-message broadcast** (send the story image as a normal message to
everyone who's chatted) reaches 100% — at the cost of landing in the chat, not the Status.

---

## Original design (mechanism)

**Goal:** Images uploaded under **Recursos → Historias / Estados** post
automatically as WhatsApp **Status** every day at a time the owner configures.

## How it works
- **Recursos → Historias** has a schedule bar: an on/off toggle, a time picker, a **Guardar**
  button, and **Publicar ahora** (post immediately, for testing / on demand).
- The schedule is stored on the store config as `story_schedule: { enabled, time }` (`time` is
  `"HH:MM"`, 24h). It's persisted in SQLite and **preserved across reseeds** (like `account_id`),
  so editing it in the panel survives a restart.
- `StoryScheduler` (`src/services/storyScheduler.ts`) ticks every 30s. When `enabled` and the
  current **server-local** time is at/just after the configured minute (within a ~2-min window),
  it posts every `story` **image** to Status, once per day (guarded by a per-day marker).
- **Audience:** every customer who has messaged or ordered from the store
  (`listCustomerJids`). Status is privacy-scoped, so Baileys requires an explicit jid list.
- Posting is skipped (not hung) when WhatsApp is offline; `Publicar ahora` reports the reason.

## API
- `GET /api/settings/story-schedule` → `{ enabled, time }` (defaults to `{false, "09:00"}`)
- `PUT /api/settings/story-schedule` `{ enabled, time }` → validates `HH:MM`, persists
- `POST /api/story/post-now` → `{ posted, audience, reason }` (`ok | disconnected | no_stories | busy`)

## Transport
`MessagingTransport.postStatusImage(path, audience, caption?)` — Baileys sends to
`status@broadcast` with `{ broadcast: true, statusJidList: audience }`.

## Caveats
- **Time is server-local.** The bot posts at the configured time **in the server's timezone**.
  A per-store timezone field is a future add if hosting moves off the owner's machine.
- **Baileys-only.** The official WhatsApp **Cloud API does NOT support posting Status** — this
  capability would be lost on a Cloud API migration (the adapter would no-op/throw).
- **ToS / ban risk.** Automated status posting is more active than replying; pilot on a
  non-critical number.
- **Images only** for now. Video Status would need `video/mp4` in the upload allow-list, a
  video-aware preview in Recursos, and a `postStatusVideo` transport method.
- **Not yet live-verified end-to-end** (needs a paired session to confirm the Status actually
  appears). Scheduler timing, persistence, validation, and the offline guard are verified.
