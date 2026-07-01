# Chats Inbox — Feasibility & Plan (future feature)

A shared-inbox view in the admin (like the reference `store_bot_admin_inbox_layout.html`):
a conversation list + message thread where the owner can watch chats and take over from
the bot. **Feasible with our current stack (Baileys)** — most plumbing already exists.

## Already in place (the hard 80%)
- **Receiving messages** — `messages.upsert` fires for every inbound message; today we route it
  to the engine instead of storing it.
- **Sending as the bot number** — `sock.sendMessage` (used for replies/notifications), so
  "owner sends from the dashboard" is the same call.
- **Take over / return to bot** — `bot_paused_until` already pauses the bot per customer; taking
  over = set it, "Devolver al bot" = clear it.
- **Live push to the browser** — the SSE channel (built for QR/status) can also stream new messages.

## What we'd add
1. **`messages` table** — persist every inbound *and* outbound message (customer_wa, store_id,
   direction, text, media ref, timestamp). We currently store order/conversation *state*, not the
   transcript.
2. **API** — list conversations (last message + unread), messages for one chat, and a
   "send as owner" endpoint.
3. **Chats UI** — 3-pane inbox: conversation list, thread with bubbles, input box, take-over control.

## Honest limitations
- **History before the bot runs is unreliable.** We get a complete transcript *from when the bot
  goes live*. WhatsApp's link-time history sync (`syncFullHistory`) is partial/flaky — treat
  backfill as best-effort, not guaranteed.
- **Baileys is unofficial** — same ToS/ban risk as the rest of the pilot.
- **Media beyond images** — photos are easy (we already download receipts); voice/stickers/docs
  each need extra handling.
- **1:1 only** — group chats are ignored (correct for a store).
- **Storage grows** — fine on SQLite for the pilot; watch at scale.

## Suggested phasing
1. **Capture** — start persisting all messages (invisible groundwork).
2. **Read-only inbox** — see conversations + threads live.
3. **Take over** — owner sends + pause / return-to-bot.

Nothing blocks this; the WhatsApp plumbing is done. The new work is the transcript store + inbox UI.
