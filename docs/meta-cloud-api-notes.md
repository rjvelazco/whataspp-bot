# Meta WhatsApp Cloud API — Cost & Setup Notes

> Reference for the **future migration** off the Baileys pilot. None of this is needed to run
> the current bot. Pricing verified June 2026 — re-check before relying on it; Meta changes it.

## Do you pay a subscription?

**No subscription to Meta.** The Cloud API is free to set up and use. You pay **per message**, and
only for *some* messages.

### The key fact for a store bot: customer-initiated = free

- **Service messages → FREE.** When a customer messages you first, it opens a **24-hour service
  window**. Every reply you send inside that window costs **$0**. The window resets with each new
  customer message. This is the entire normal flow of the bot (customer asks → bot answers).
- **Business-initiated templates → paid.** You only pay when *you* start a conversation outside the
  window — e.g. proactively sending "tu pedido fue enviado 🚚". These are categorized and priced
  per message:

| Category | Rough cost (varies by country) |
|---|---|
| Service (reply in 24h window) | **Free** |
| Authentication | ~$0.004 (US) – €0.05 (DE) per msg |
| Utility (e.g. "order shipped") | ~80–90% cheaper than marketing |
| Marketing | ~$0.0094 (IN) – ~$0.124 (DE) per msg |

- **Click-to-WhatsApp ads** open a **72-hour** free window (all messages free, even business-initiated).

**Bottom line:** for a bot where customers always message first, the Meta bill is effectively **~$0**.
Costs only appear if you add proactive notifications.

## Do you need a BSP (Twilio / 360dialog)?

**No, not to start.** You can use Meta's Cloud API directly for free. BSPs add a platform
subscription **plus** a per-message markup (Twilio ~$0.005/msg on top of Meta's fee). A BSP only
becomes worth it later, when onboarding many client numbers directly through Meta gets painful
(the "make it sellable" phase).

## Do you need a token? Yes.

An **access token** is required to call Meta's Graph API to send messages.

| Token | Use | Lifespan |
|---|---|---|
| Temporary | Testing / dev | 24 hours (regenerate in dashboard) |
| Permanent (System User token) | Production | Does not expire |

## How to get a token (step by step)

1. Go to **developers.facebook.com**, log in with a Facebook account, create a **Meta Developer
   account** (free).
2. **Create an App** → type **Business**.
3. Add the **WhatsApp** product to the app.
4. On the WhatsApp setup page, Meta gives you for free:
   - a **test phone number** (send/receive without registering a real number),
   - a **temporary access token** (the 24h one),
   - a **`phone_number_id`** (the value the engine routes stores by — `resolveStore()`).
5. For production: **Business Settings → System Users** → create a system user → generate a
   **permanent token**, then register your real WhatsApp Business number.

> The **test number can only message up to 5 pre-approved recipients** you add in the dashboard.
> Fine for dev; you can't reach real customers until you register a real number.

## How this maps to our codebase

The engine never changes. Migrating means:

1. Add `src/transport/cloudApi.ts` implementing `MessagingTransport` (webhook receiver + Graph API
   sender). Unlike Baileys, the Cloud API **pushes** messages to a public webhook URL — so this
   adapter runs an HTTP server (Express/Hono) and you expose it (ngrok for local dev, a host in prod).
2. Store each store's `phone_number_id` in its config so `resolveStore()` can route many stores from
   one deployment.
3. Put the access token + a webhook verify token in `.env`.

Everything in `src/engine/*` stays identical — that's the whole point of the transport seam.

## Sources (June 2026)

- https://blueticks.co/blog/whatsapp-business-api-pricing-2026
- https://chatarmin.com/en/blog/whats-app-api-pricing
- https://www.twilio.com/en-us/whatsapp/pricing
- https://www.uptail.ai/blog/whatsapp-business-api-pricing-2026-what-it-costs-and-how-billing-works
