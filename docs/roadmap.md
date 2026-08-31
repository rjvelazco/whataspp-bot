# Roadmap

What we plan to build next, the decisions already taken, and the questions still open.
Written so that whoever picks a task up — person or AI — starts from the same
understanding. Rules for *how* to build live in `CLAUDE.md` (arriving with the conventions PR); this
file is about *what*.

Nothing here is committed to a date. Items are ordered by dependency, not priority.

---

## 1. Run against a real store

The pilot data (`src/data/novamoda.*.json`) is invented. The next milestone is running
the bot against a real shop's catalogue, prices and messages, because the failure modes
that matter — a customer typing a product name three different ways, a size that only
exists in one colour — do not appear in fixture data.

**The blocker is privacy, and it is not optional.**

`src/data/novamoda.store.json`, `.catalog.json` and `.menus.json` are **tracked in git**,
and this repository is **public**. Committing a real shop's address, phone number, Pago
Móvil details or supplier prices puts them in the history permanently — deleting the file
later does not remove them. The same applies to `store-bot.sqlite`, `uploads/`, and the
WhatsApp session in the auth directory.

Already safe, verified against `.gitignore`: the database (`*.sqlite`), `uploads/` and
the `auth/` session directory are all ignored. The gap is the seed.

Before any real data is loaded:

- [ ] Move the real store's seed out of `src/data/` — a gitignored path pointed at by an
      env var (`SEED_DIR`), so the tracked files stay as the public example.
- [ ] Never paste real customer numbers, receipts or order screenshots into an issue, a
      PR, or a chat with an AI assistant.

Two things worth knowing before loading data:

- **The database wins after the first boot.** `seedStore()` imports the JSON only when a
  store has no rows; after that it preserves owner edits and never re-imports. So editing
  the seed does nothing to a database that already exists — the reset in §2 is what makes
  a re-seed take effect.
- **`store_id` is threaded through every table but only one store runs.** Using the real
  shop's id from the start avoids a rename later; it appears in the DB, the seed
  filenames and `STORE_ID`.

---

## 2. A reset for the transactional data

To start clean against real data we need to clear what was accumulated while testing,
without losing the configuration or the paired WhatsApp session.

| Cleared | Kept |
|---|---|
| `orders`, `conversations` | `stores` (name, hours, payments, keywords, rate) |
| `catalog_items` | `menus` |
| receipts in `uploads/receipts/` | `assets` and `stories` — the owner uploaded those |
| product photos in `uploads/products/` | the auth directory — clearing it forces re-pairing |

Design notes for whoever builds it:

- **Delete the files, not just the rows.** A receipt or a product photo whose row is gone
  is unreachable bytes; `deleteAssetAndFile` in `src/services/stories.ts` is the pattern.
- **`contacts` is a judgement call.** It is the Status audience, so clearing it silences
  Estados until customers write again. Default to keeping it, and offer a flag.
- **Back up first.** The script should copy the database beside itself with a timestamp
  before touching anything.
- **Make it hard to run by accident.** A `npm run reset:data` that requires typing the
  store id to confirm, and refuses outright unless `NODE_ENV !== 'production'`.
- Some fields live in a column *and* inside `data_json` (`orders.status`,
  `catalog_items.active`). A `DELETE` avoids that trap; a partial reset would not.

---

## 3. A local model in the loop

The goal is a model running on the same machine as the bot — no per-token cost, and no
customer message leaving the building. Three uses, in increasing order of risk.

### 3.1 Products from a PDF or a spreadsheet

**Most of this does not need a model.** A supplier spreadsheet is columns: name, code,
size, colour, price, stock. That is a parsing and column-mapping problem, and a
deterministic importer is faster, free, and — critically — *repeatable*, which a model is
not. We already depend on `write-excel-file` for the Pagos export; the reading side is
the same shape.

Build in this order:

1. **Spreadsheet import, no AI.** Upload, preview the first rows, map columns to fields,
   confirm. The preview is the feature: it turns a silent bad import into a visible one.
2. **A model only for unstructured PDFs** — a scanned price list, a catalogue laid out for
   humans. Extraction into the *same* mapping preview, so the owner still confirms before
   anything is written.

The rule: the model proposes rows, a person accepts them. Nothing reaches `catalog_items`
without a human looking at it.

### 3.2 Drafting menus

Low risk, because the output is reviewed before it can affect a customer: describe the
shop, get a draft menu tree, edit it in the Menús editor, save. `validateFlow` already
rejects a broken flow, so the worst case is a draft that fails validation.

Worth doing after §3.1, and worth keeping modest — the editor is already fast for someone
who knows what they want.

### 3.3 Checking an order against the catalogue

The valuable one, and the one that can hurt a real customer. A shopper writes:

> quiero 2 camisas negras M y una falda roja talla S

…and the bot answers what is available, what is not, and what is out of stock.

**The architecture that makes this safe: the model extracts, the code decides.**

- The model's only job is turning free text into a **structured list** — `{ name, size,
  colour, qty }` per line. It never sees a price, never sees stock, and never writes a
  word the customer reads.
- Existence, stock, price and totals are answered by querying `catalog_items`, exactly as
  today. The reply is built by our own message builders in `src/engine/menus.ts`.
- If the model returns something that does not validate against the schema, we fall back
  to the current step-by-step flow. A slow or wrong model degrades to what we already
  ship; it never blocks an order.

This is also what stops the model inventing a discount: it has no channel to the customer
to invent one *in*.

### Which model, and the latency budget

A customer on WhatsApp waits seconds, not tens of seconds. Constraints to design to:

- A small instruct model (7–8B class) is enough for constrained extraction, and is what a
  laptop can serve. Whatever the runtime, use **constrained JSON output** — a schema or a
  grammar — rather than hoping the text parses.
- **Give every call a hard timeout** and a fallback path. The bot must answer even when
  the model does not.
- Spanish, and Venezuelan Spanish at that (*talla*, *tallas*, local sizing). Test with
  real messages, not translated English ones.
- If the bot ever moves off a laptop to a small VPS, a local model may not fit. Keep the
  model behind an interface so it can be swapped for a hosted one without touching the
  engine.

---

## 4. Guardrails

The concern — the bot giving away a promotion, wandering off topic, or burning money — is
right, and most of it is answered structurally rather than by prompt wording. A prompt is
a request; a state machine is a rule.

1. **Only run the model where it is needed.** `ConvState` already distinguishes
   `ordering_*` and `confirming` from `idle` and `in_menu`. Calling the model outside
   those states is the single biggest saving, and it means a customer chatting about the
   weather never reaches it.
2. **The model never produces customer-facing text.** It returns structured data that we
   validate; every word the customer reads still comes from `src/engine/menus.ts`. This
   is what makes "it must not offer discounts" a fact about the design rather than a hope
   about the prompt.
3. **Prices, stock and totals come from the database, always.** No exceptions, including
   "the model already knows the price".
4. **Cap the input.** Truncate the message, cap history, and refuse absurd quantities
   before they reach either the model or the order.
5. **Log every call** with its latency and whether it fell back. Without that we cannot
   tell "the AI works" from "the AI silently fails and the old flow carries it".
6. **A kill switch.** One setting that disables the model everywhere and returns the bot
   to today's behaviour. It should be reachable from the admin panel, not a redeploy.

Testing an extraction feature is not like testing a pure function: keep a growing file of
real customer phrasings with their expected structured output, and assert the extraction,
never the exact wording of a reply.

---

## 5. What MCP is, and where it fits

Worth separating two different things, because they need different tools:

- **AI inside the bot, serving customers** (§3.3). This does **not** need MCP. The model
  runs in-process and we call it directly with a validated schema. Adding a protocol
  between our own function and our own database buys nothing and adds a hop on the path a
  customer is waiting on.
- **AI outside the bot, serving the owner.** *This* is where MCP earns its place: an MCP
  server exposing the store as tools — `list_orders`, `create_product`,
  `import_catalogue`, `post_story` — so the owner can drive the shop from an AI client
  ("add these twenty products from this PDF", "which orders are unpaid?"). It is the
  natural home for §3.1, and it reuses the API in `src/web/server.ts` that already exists.

If the MCP server is built, it inherits the same rules: it is an admin surface, so it
needs the `ADMIN_TOKEN` boundary, and destructive tools need confirmation.

---

## Decisions already taken

- **Real data lives outside git.** The tracked seed files stay as the public example.
- **The model extracts; the code decides.** No price, stock or customer-facing sentence
  ever originates in a model.
- **Deterministic import first, AI second.** A spreadsheet with columns is not an AI
  problem.
- **Gate by conversation state**, not by prompt instructions.
- **MCP is for the owner-facing side**, not for the customer path.

## Open questions

- Which store id and which real shop do we start with, and does its catalogue exist in a
  form we can import at all — a spreadsheet, a PDF, or photographs of a notebook?
- Does `contacts` survive the reset by default?
- Where does the bot run once it is real? That decides whether a local model is viable.
- Is there an "agent mode" the owner can toggle per conversation — the request mentioned
  wanting one — and does it differ from the existing human-handoff pause?

## Explicitly not doing yet

- Multi-store. The schema carries `store_id` everywhere, but nothing else is ready and
  nothing needs it.
- Letting a model reply in free text to a customer. Not until everything above has been
  running against a real shop for a while.
- Voice notes. A customer sending an audio order is a real behaviour and a much larger
  piece of work.
