# WhatsApp Status (Estados) — daily auto-post

**Status:** ✅ Built. Images uploaded under **Recursos → Historias / Estados** are posted
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
