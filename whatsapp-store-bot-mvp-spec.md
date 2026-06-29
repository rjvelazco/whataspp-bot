# WhatsApp Store Bot — MVP Spec

**Goal:** Build one reusable WhatsApp bot that handles the repetitive sales DMs for a clothing store (browse, sizing, availability, order, payment). Pilot it on your girlfriend's brand, but keep everything store-specific in config so store #2 is a form, not a rewrite.

**Design rule:** If onboarding a new store ever requires editing code, you've broken the model. Code = generic engine. Data/config = per-store.

---

## 1. Scope

**In scope (v1):**

- Greeting + main menu
- Browse catalog by category
- Check item availability (size / color / stock)
- Send size guide
- Capture an order (item, size, qty, customer name, delivery address)
- Send payment instructions + receive payment receipt photo
- Notify store owner of new orders
- Basic FAQ (hours, delivery zones, returns, restocks)
- Human handoff ("hablar con una persona")

**Out of scope (later):**

- AI / natural-language understanding (v1 uses buttons + keywords)
- Multi-store admin SaaS dashboard (v1 = config file or single DB table)
- Automatic payment verification (owner confirms manually in v1)
- Marketing broadcast campaigns

> Ship the button-based version first. Add the AI layer once it's live and working — that becomes your selling point for client #2.

---

## 2. Conversation Flows

Notation: **Bot:** = bot message, `[Button]` = quick-reply button, *(action)* = system action.

### 2.1 Greeting / Main Menu

Trigger: any first message, or keywords `hola`, `menu`, `inicio`.

```
Bot: ¡Hola! 👋 Bienvenid@ a {store_name}.
     ¿En qué te puedo ayudar?
     [Ver catálogo] [Consultar talla] [Hacer pedido]
     [Envíos y pagos] [Hablar con alguien]
```

### 2.2 Browse Catalog

```
Customer: [Ver catálogo]
Bot: ¿Qué te interesa?
     [Vestidos] [Tops] [Pantalones] [Ofertas]

Customer: [Vestidos]
Bot: (sends 1 message per item, up to N)
     📷 [photo]
     Vestido Bohemio — $25
     Tallas: S, M, L · Colores: negro, beige
     Escribe "PEDIR VESTBOHEMIO" para ordenar.
     [Ver más] [Volver al menú]
```

Items come from the store's catalog data. Each item has a short `code` (e.g. `VESTBOHEMIO`) used to reference it in orders.

### 2.3 Check Availability / Sizing

This is the highest-value flow for clothing.

```
Customer: ¿tienen el vestido bohemio en M?
Bot: (looks up item + size in stock data)
     ✅ Sí, el Vestido Bohemio está disponible en talla M (negro y beige).
     ¿Quieres ordenarlo? [Hacer pedido] [Ver medidas]

     -- or, if out of stock --
     😕 Ahora mismo no tenemos talla M del Vestido Bohemio.
     [Avísame cuando llegue] [Ver otras tallas]
```

Size guide on request:

```
Customer: [Ver medidas]
Bot: 📏 Guía de tallas:
     S → busto 84cm, cintura 66cm
     M → busto 90cm, cintura 72cm
     L → busto 96cm, cintura 78cm
     ¿Necesitas ayuda para elegir? [Hablar con alguien]
```

### 2.4 Place an Order

```
Customer: PEDIR VESTBOHEMIO   (or [Hacer pedido])
Bot: ¡Buena elección! Vestido Bohemio.
     ¿Qué talla? [S] [M] [L]
Customer: [M]
Bot: ¿Color? [Negro] [Beige]
Customer: [Negro]
Bot: ¿Cuántas unidades?
Customer: 1
Bot: ¿A nombre de quién es el pedido?
Customer: María Pérez
Bot: ¿Dirección / zona de entrega?
Customer: Maracaibo, Av. 5 de Julio
Bot: Confirmemos tu pedido:
     • Vestido Bohemio — Talla M — Negro — x1
     • Total: $25 + envío
     • Para: María Pérez · Maracaibo, Av. 5 de Julio
     [Confirmar pedido] [Cancelar]
```

*(action: on Confirm → create order record, status = `pending_payment`, go to payment flow, notify owner)*

### 2.5 Payment

```
Bot: Para completar tu pedido, paga por una de estas opciones:
     💳 Pago Móvil: {pagomovil_details}
     💵 Zelle: {zelle_email}
     🪙 Binance (USDT): {binance_id}
     Cuando pagues, envía aquí la foto del comprobante. 📸

Customer: (uploads receipt image)
Bot: ¡Gracias! Recibimos tu comprobante. ✅
     {store_name} lo verificará y te confirma el envío pronto.
```

*(action: save image URL to order, set status = `payment_submitted`, notify owner to verify)*

### 2.6 Owner Notification

When an order hits `payment_submitted`, send the owner (separate WhatsApp number):

```
🛍️ NUEVO PEDIDO #{order_id}
María Pérez — Vestido Bohemio M Negro x1 — $25
Zona: Maracaibo, Av. 5 de Julio
Pago: comprobante adjunto 📎
Responde "OK {order_id}" para confirmar.
```

### 2.7 FAQ

Keyword/menu driven. Each answer pulled from store config:

```
[Envíos y pagos]
Bot: 🚚 Envíos: {delivery_info}
     💰 Pagos: Pago Móvil, Zelle, Binance.
     ↩️ Cambios: {returns_policy}
```

### 2.8 Human Handoff

```
Customer: [Hablar con alguien]
Bot: Claro, le aviso a {owner_name}. Te escribirá pronto. 🙌
     (action: notify owner, pause bot for this customer for X hours)
```

> **Important:** when a human is handling a chat, the bot must go quiet so it doesn't talk over the owner. Add a per-customer `bot_paused_until` timestamp.

---

## 3. Data Model

Keep it small. Two config entities (store, catalog item) and two runtime entities (order, conversation state).

### 3.1 `stores` (the per-store config — your "build once" payoff)

```json
{
  "store_id": "novamoda",
  "store_name": "Nova Moda",
  "owner_name": "Ana",
  "owner_whatsapp": "+58412XXXXXXX",
  "phone_number_id": "1234567890",       // WhatsApp Cloud API number for THIS store
  "hours": "Lun-Sab 9am-6pm",
  "delivery_info": "Envíos nacionales por MRW/Zoom. Local en Maracaibo $2.",
  "returns_policy": "Cambios dentro de 7 días con etiqueta.",
  "payments": {
    "pago_movil": "0102 / V-12345678 / 0412XXXXXXX",
    "zelle": "ana@email.com",
    "binance": "ana_usdt"
  },
  "size_guide": [
    { "size": "S", "busto": 84, "cintura": 66 },
    { "size": "M", "busto": 90, "cintura": 72 },
    { "size": "L", "busto": 96, "cintura": 78 }
  ],
  "categories": ["Vestidos", "Tops", "Pantalones", "Ofertas"]
}
```

### 3.2 `catalog_items`

```json
{
  "item_id": "uuid",
  "store_id": "novamoda",
  "code": "VESTBOHEMIO",
  "name": "Vestido Bohemio",
  "category": "Vestidos",
  "price": 25.00,
  "photo_url": "https://.../vestbohemio.jpg",
  "active": true,
  "variants": [
    { "size": "S", "color": "negro", "stock": 3 },
    { "size": "M", "color": "negro", "stock": 0 },
    { "size": "M", "color": "beige", "stock": 5 },
    { "size": "L", "color": "beige", "stock": 2 }
  ]
}
```

Stock lives at the variant level so availability checks are exact ("M en negro" can be sold out while "M en beige" is in stock).

### 3.3 `orders`

```json
{
  "order_id": "1042",
  "store_id": "novamoda",
  "customer_wa": "+58414XXXXXXX",
  "customer_name": "María Pérez",
  "items": [
    { "code": "VESTBOHEMIO", "size": "M", "color": "negro", "qty": 1, "price": 25.00 }
  ],
  "delivery_address": "Maracaibo, Av. 5 de Julio",
  "subtotal": 25.00,
  "status": "payment_submitted",   // pending_payment | payment_submitted | confirmed | shipped | cancelled
  "receipt_url": "https://.../receipt1042.jpg",
  "created_at": "2026-06-25T14:00:00Z"
}
```

### 3.4 `conversations` (state machine per customer)

```json
{
  "customer_wa": "+58414XXXXXXX",
  "store_id": "novamoda",
  "state": "ordering_size",   // idle | browsing | checking_size | ordering_size | ordering_color | ordering_qty | ordering_name | ordering_address | confirming | awaiting_payment
  "draft_order": { "code": "VESTBOHEMIO", "size": null, "color": null, "qty": null },
  "bot_paused_until": null,
  "updated_at": "2026-06-25T14:00:00Z"
}
```

The bot is a **state machine**: each incoming message + current `state` decides the next reply and the next `state`. This is the heart of the engine — get this right and everything else is plumbing.

---

## 4. System Flow (how a message travels)

```
Customer WhatsApp
      │  (sends message)
      ▼
Meta WhatsApp Cloud API  ──webhook POST──►  Your bot endpoint (host)
                                                  │
                                                  ├─ read conversation state (DB)
                                                  ├─ read store config + catalog (DB)
                                                  ├─ decide reply (state machine)
                                                  ├─ write new state / order (DB)
                                                  │
      Customer WhatsApp  ◄──Graph API call──┘  (send reply)
                                                  │
                                          (on order) ──► notify owner WhatsApp
```

Routing for multi-store: the webhook payload includes the `phone_number_id` the message came in on → look up which `store_id` that belongs to → load that store's config. That one lookup is what makes a single deployment serve many stores.

---

## 5. Build Checklist (weekend-sized)

**Phase 0 — Accounts (do first, some have approval delays)**

- [ ] Meta Developer account + create an app (WhatsApp product)
- [ ] Get a test phone number ID + temporary token (Meta provides one for dev)
- [ ] Create database (Supabase project)
- [ ] Create hosting project (Railway or Cloudflare Workers)

**Phase 1 — Plumbing (get a single round-trip working)**

- [ ] Webhook endpoint: verify (GET challenge) + receive (POST messages)
- [ ] Parse incoming message (text vs button vs image) + sender + phone_number_id
- [ ] Send-message helper (calls Graph API: text, buttons, image)
- [ ] Echo test: reply "recibí: X" to any message ✅ milestone

**Phase 2 — Engine (the reusable core)**

- [ ] DB schema: stores, catalog_items, orders, conversations
- [ ] Load store config by phone_number_id
- [ ] Conversation state machine (idle → browsing → ordering → ... )
- [ ] Greeting + main menu with buttons

**Phase 3 — Store features**

- [ ] Browse catalog by category (pull from catalog_items)
- [ ] Availability / size check against variants
- [ ] Size guide from store config
- [ ] Order flow (collect size/color/qty/name/address → confirm)
- [ ] Save order, set status pending_payment

**Phase 4 — Payment + owner**

- [ ] Send payment instructions from store config
- [ ] Receive + store receipt image
- [ ] Notify owner of new order
- [ ] Human handoff + bot_paused_until

**Phase 5 — Pilot with girlfriend's store**

- [ ] Fill her real config + catalog
- [ ] Connect her real WhatsApp Business number (via BSP — see notes)
- [ ] Test every flow end-to-end yourself
- [ ] Have her use it for real for a week; log what breaks / what customers ask
- [ ] Iterate

**Phase 6 — Make it sellable (after pilot works)**

- [ ] Simple admin form to add a store + catalog (so onboarding ≠ DB edits)
- [ ] Add AI layer for free-text questions (optional upgrade)
- [ ] Write a 1-page offer + price; demo bot for prospects

---

## 6. Tech Stack (suggested)

- **Language/framework:** Node + Express (always-on host) OR a Cloudflare Worker (serverless). Worker is cheapest and never sleeps.
- **WhatsApp:** Meta Cloud API directly for the pilot; move to a **BSP** (360dialog / Twilio) when onboarding real client numbers — it makes connecting each store's number far easier.
- **Database + file storage:** Supabase (Postgres + storage for receipt photos).
- **AI (later):** OpenAI `gpt-4o-mini` (cheapest) or Claude Haiku for catalog Q&A.

---

## 7. Monthly Cost (the part you asked about)

Prices verified June 2026. Two realistic stages:

### Stage A — Pilot (just your girlfriend's store, low volume)

| Service | Choice | Monthly cost |
|---|---|---|
| Hosting | Cloudflare Workers (free tier: 100k req/day) | **$0** |
| Database + file storage | Supabase (free tier) | **$0** |
| WhatsApp messages | Cloud API — customer-initiated replies are free in the 24h window | **~$0** |
| AI | none in v1 | **$0** |
| **Total** | | **~$0 / month** |

You can genuinely run the pilot for free. The only paid thing is *outbound* template messages (e.g. "your order shipped"), at ~$0.004 each (utility) — pennies.

### Stage B — Running for paying clients (a handful of stores)

| Service | Choice | Monthly cost |
|---|---|---|
| Hosting | Cloudflare Workers free, or Railway/Render Hobby if you prefer always-on Node | **$0–5** |
| Database + storage | Supabase free → Pro when you outgrow it | **$0–25** |
| WhatsApp | per-message (mostly free inbound; you/clients pay for marketing/utility templates) | **usage-based, low** |
| AI (optional) | gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output tokens (Claude Haiku 4.5: $1 / $5) — cents per conversation | **a few $** |
| Uptime monitoring | UptimeRobot free | **$0** |
| **Total** | | **~$5–35 / month total**, not per client |

The economics are the whole point: your costs are roughly flat (~$5–35/mo) while each client pays a setup fee + $20–50/mo retainer. Five retainer clients ≈ $100–250/mo revenue against ~$5–35 cost. That margin is why this beats reselling physical goods.

> Note on the free tiers: Cloudflare Workers' free tier is the real always-on option (it doesn't sleep). Avoid Render/Railway *free* tiers for the bot — they spin down after inactivity and the first message after a quiet period is slow. If you want always-on Node instead of a Worker, pay the $5 Hobby tier.

---

## 8. First Step

Don't start with code. Start by filling in `stores` + `catalog_items` for your girlfriend's actual brand — her real products, prices, sizes, payment details. Building from real data keeps you honest about what the bot must do, and it's literally the config you'll ship on. Then do Phase 1 (echo test) to prove the pipe works. Everything else builds on those two.
