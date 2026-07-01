# WhatsApp Status (Estados) — Plan

**Goal:** the images uploaded under **Recursos → Historias / Estados** get posted
automatically as WhatsApp **Status** when the bot starts.

Status (`story`) is a third **asset category** alongside `catalog` and `promo`. Today the
Recursos section only **stores** these files (upload/preview/delete) — the auto-posting is
not wired yet.

## Feasibility
- **Baileys supports it.** Status is posted by sending to the special `status@broadcast`
  address with an image/video/text payload, plus an **audience list** (Status is
  privacy-scoped — you must specify which contacts can see it).
- The bot already knows customers who've messaged it (jids on orders/conversations), so the
  audience could default to "customers who've contacted the store," or a chosen list.

## Planned behavior (not built)
- On bot startup (connection `open`), post each `story` asset as a WhatsApp Status.
- Likely guard against re-posting the same asset every restart (track a `posted_at` per asset,
  or only post assets added since last run).
- Audience = interacted customers (or configurable).

## Caveats
- **Baileys-only.** The official WhatsApp **Cloud API does NOT support posting Status** — this
  capability would be lost if we migrate to the Cloud API for scaling.
- **ToS / ban risk.** Automated status posting is more active behavior than replying; pilot on a
  non-critical number.
- **Media:** images to start; video Status would need `video/mp4` added to the upload allow-list
  and a video-aware preview in Recursos.
