import express, { type Response } from "express";
import multer from "multer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type {
  Asset,
  AssetCategory,
  CatalogItem,
  Order,
  OrderStatus,
  Store,
  StorySchedule,
  Variant,
} from "../domain/types.js";
import {
  createAsset,
  createItem,
  deleteAsset,
  getAsset,
  getItemById,
  getMenus,
  getOrder,
  getStoreById,
  listAllItems,
  listAssets,
  listContacts,
  listOrders,
  saveMenus,
  softDeleteItem,
  updateItem,
  updateOrder,
  upsertStore,
} from "../db/repositories.js";
import {
  customerCheckInMessage,
  customerDeliveredMessage,
  customerOrderCancelledMessage,
  customerPaymentConfirmedMessage,
  customerShippedMessage,
} from "../services/notify.js";

/** Connection status as the browser needs it (QR already rendered to a data URL). */
export type WebStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "qr"; qrDataUrl: string }
  | { state: "open"; accountId: string };

/** What the web server needs from the rest of the app. */
export interface WebDeps {
  store: Store;
  /** Send a WhatsApp message (used to notify the customer on payment verification). */
  sendMessage: (to: string, body: string) => Promise<void>;
  /** Unlink the bot from WhatsApp (shows a fresh QR to re-pair). */
  disconnect: () => Promise<void>;
  /** Post the store's "story" assets to WhatsApp Status right now. */
  postStoryNow: () => Promise<{ posted: number; audience: number; reason: string }>;
}

const DEFAULT_STORY_SCHEDULE: StorySchedule = { enabled: false, time: "09:00" };

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "..", "web", "dist", "store-admin", "browser");
const indexHtml = join(webDir, "index.html");
const assetsDir = join(config.uploadsDir, "assets");
const productsDir = join(config.uploadsDir, "products");

const ALLOWED_ASSET_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Multer: store uploads under uploads/assets with a random, extension-preserving name. */
const uploadAsset = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assetsDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_ASSET_TYPES.has(file.mimetype)),
});

/** Multer for product photos: images only, stored under uploads/products. */
const uploadProductPhoto = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, productsDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => cb(null, IMAGE_TYPES.has(file.mimetype)),
});

const isHttpUrl = (s: string): boolean => /^https?:\/\//.test(s);

/** better-sqlite3 raises this code when the (store_id, code) unique index is violated. */
function isDuplicateCodeError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

/** Validate + normalize a product payload into a CatalogItem (throws on bad input). */
function buildItemFromBody(
  body: unknown,
  storeId: string,
  existing?: CatalogItem,
): CatalogItem {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const code = String(b.code ?? "").trim().toUpperCase();
  const category = String(b.category ?? "").trim();
  const price = Number(b.price);
  if (!name) throw new Error("El nombre es obligatorio");
  if (!code) throw new Error("El código es obligatorio");
  if (!category) throw new Error("La categoría es obligatoria");
  if (!Number.isFinite(price) || price < 0) throw new Error("El precio debe ser un número válido");

  const variants: Variant[] = Array.isArray(b.variants)
    ? (b.variants as unknown[])
        .map((v) => {
          const vv = (v ?? {}) as Record<string, unknown>;
          return {
            size: String(vv.size ?? "").trim(),
            color: String(vv.color ?? "").trim(),
            stock: Math.max(0, Math.floor(Number(vv.stock) || 0)),
          };
        })
        .filter((v) => v.size && v.color)
    : [];

  return {
    item_id: existing?.item_id ?? randomUUID(),
    store_id: storeId,
    code,
    name,
    category,
    price,
    photo_url: typeof b.photo_url === "string" ? b.photo_url : existing?.photo_url ?? "",
    active: b.active === undefined ? existing?.active ?? true : Boolean(b.active),
    variants,
  };
}

/**
 * Serves the Angular admin UI, streams connection status over SSE, and exposes
 * the orders API. Runs inside the bot process, so it shares the DB and transport.
 */
export class WebServer {
  private readonly clients = new Set<Response>();
  private status: WebStatus = { state: "idle" };

  constructor(private readonly deps: WebDeps) {}

  /** Update the current status and push it to every connected browser. */
  setStatus(status: WebStatus): void {
    this.status = status;
    const frame = `data: ${JSON.stringify(status)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }

  /** Look up an order, scoped to this instance's store. */
  private findOrder(id: string): Order | undefined {
    const order = getOrder(id);
    return order && order.store_id === this.deps.store.store_id ? order : undefined;
  }

  /** Advance an order from one status to the next, notifying the customer. */
  private async advance(
    res: Response,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    message: (order: Order, store: Store) => string,
  ): Promise<void> {
    const order = this.findOrder(id);
    if (!order) {
      res.status(404).json({ error: "order not found" });
      return;
    }
    if (order.status !== from) {
      res.status(409).json({ error: `order is not ${from}` });
      return;
    }
    const updated = { ...order, status: to };
    updateOrder(updated);
    const notified = await this.trySend(order.customer_wa, message(updated, this.deps.store));
    logger.info({ orderId: order.order_id, to, notified }, "order advanced");
    res.json({ order: updated, notified });
  }

  /** Send a WhatsApp message, reporting whether it went out. Skips when offline
   *  (sending on a non-open socket would hang), so callers get an honest result. */
  private async trySend(to: string, body: string): Promise<boolean> {
    if (this.status.state !== "open") {
      logger.warn("skipping send — WhatsApp not connected");
      return false;
    }
    try {
      await this.deps.sendMessage(to, body);
      return true;
    } catch (err) {
      logger.error({ err }, "failed to send message");
      return false;
    }
  }

  listen(port: number): void {
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(productsDir, { recursive: true });
    const app = express();
    app.use(express.json());

    // --- Server-Sent Events: current status now, then live updates ---
    app.get("/api/events", (req, res) => {
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      res.write(`data: ${JSON.stringify(this.status)}\n\n`);
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
    });

    // --- Orders API ---
    app.get("/api/orders", (_req, res) => {
      res.json(listOrders(this.deps.store.store_id));
    });

    app.get("/api/orders/:id/receipt", (req, res) => {
      const order = getOrder(req.params.id);
      if (
        !order ||
        order.store_id !== this.deps.store.store_id ||
        !order.receipt_url ||
        !existsSync(order.receipt_url)
      ) {
        res.status(404).send("no receipt");
        return;
      }
      res.sendFile(order.receipt_url);
    });

    app.post("/api/orders/:id/verify", async (req, res) => {
      const order = getOrder(req.params.id);
      if (!order || order.store_id !== this.deps.store.store_id) {
        res.status(404).json({ error: "order not found" });
        return;
      }
      const updated = { ...order, status: "confirmed" as const };
      updateOrder(updated);
      const notified = await this.trySend(
        order.customer_wa,
        customerPaymentConfirmedMessage(updated, this.deps.store),
      );
      logger.info({ orderId: order.order_id, notified }, "payment verified");
      res.json({ order: updated, notified });
    });

    // Send the customer a check-in (does not change the order).
    app.post("/api/orders/:id/remind", async (req, res) => {
      const order = this.findOrder(req.params.id);
      if (!order) {
        res.status(404).json({ error: "order not found" });
        return;
      }
      const notified = await this.trySend(order.customer_wa, customerCheckInMessage(order, this.deps.store));
      logger.info({ orderId: order.order_id, notified }, "reminder sent");
      res.json({ notified });
    });

    // Cancel an order and tell the customer.
    app.post("/api/orders/:id/cancel", async (req, res) => {
      const order = this.findOrder(req.params.id);
      if (!order) {
        res.status(404).json({ error: "order not found" });
        return;
      }
      const updated = { ...order, status: "cancelled" as const };
      updateOrder(updated);
      const notified = await this.trySend(
        order.customer_wa,
        customerOrderCancelledMessage(updated, this.deps.store),
      );
      logger.info({ orderId: order.order_id, notified }, "order cancelled");
      res.json({ order: updated, notified });
    });

    // Fulfillment: confirmed → shipped.
    app.post("/api/orders/:id/ship", async (req, res) => {
      await this.advance(res, req.params.id, "confirmed", "shipped", customerShippedMessage);
    });

    // Fulfillment: shipped → delivered.
    app.post("/api/orders/:id/deliver", async (req, res) => {
      await this.advance(res, req.params.id, "shipped", "delivered", customerDeliveredMessage);
    });

    // --- Assets (catalog / promo files) ---
    app.get("/api/assets", (_req, res) => {
      res.json(listAssets(this.deps.store.store_id));
    });

    app.post("/api/assets/:category", uploadAsset.single("file"), (req, res) => {
      const category = req.params.category as AssetCategory;
      if (category !== "catalog" && category !== "promo" && category !== "story") {
        res.status(400).json({ error: "invalid category" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "no file — must be JPG/PNG/WebP/PDF up to 15 MB" });
        return;
      }
      const asset: Asset = {
        id: randomUUID(),
        store_id: this.deps.store.store_id,
        category,
        filename: req.file.filename,
        original_name: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        created_at: new Date().toISOString(),
      };
      createAsset(asset);
      logger.info({ id: asset.id, category }, "asset uploaded");
      res.json(asset);
    });

    app.get("/api/assets/:id/file", (req, res) => {
      const asset = getAsset(req.params.id);
      if (!asset || asset.store_id !== this.deps.store.store_id) {
        res.status(404).send("not found");
        return;
      }
      res.sendFile(join(assetsDir, asset.filename));
    });

    app.delete("/api/assets/:id", (req, res) => {
      const asset = getAsset(req.params.id);
      if (!asset || asset.store_id !== this.deps.store.store_id) {
        res.status(404).json({ error: "not found" });
        return;
      }
      rmSync(join(assetsDir, asset.filename), { force: true });
      deleteAsset(asset.id);
      logger.info({ id: asset.id }, "asset deleted");
      res.json({ ok: true });
    });

    // --- Catalog (products) — DB is the source of truth the bot reads each message ---
    app.get("/api/catalog", (_req, res) => {
      res.json(listAllItems(this.deps.store.store_id));
    });

    app.post("/api/catalog", (req, res) => {
      let item: CatalogItem;
      try {
        item = buildItemFromBody(req.body, this.deps.store.store_id);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      try {
        createItem(item);
      } catch (err) {
        if (isDuplicateCodeError(err)) {
          res.status(409).json({ error: `Ya existe un producto con el código ${item.code}` });
          return;
        }
        throw err;
      }
      logger.info({ itemId: item.item_id, code: item.code }, "product created");
      res.json(item);
    });

    app.put("/api/catalog/:id", (req, res) => {
      const existing = getItemById(this.deps.store.store_id, req.params.id);
      if (!existing) {
        res.status(404).json({ error: "producto no encontrado" });
        return;
      }
      let item: CatalogItem;
      try {
        item = buildItemFromBody(req.body, this.deps.store.store_id, existing);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      try {
        updateItem(item);
      } catch (err) {
        if (isDuplicateCodeError(err)) {
          res.status(409).json({ error: `Ya existe un producto con el código ${item.code}` });
          return;
        }
        throw err;
      }
      logger.info({ itemId: item.item_id }, "product updated");
      res.json(item);
    });

    // Soft delete: hide from the bot but keep the row so past orders still resolve.
    app.delete("/api/catalog/:id", (req, res) => {
      if (!softDeleteItem(this.deps.store.store_id, req.params.id)) {
        res.status(404).json({ error: "producto no encontrado" });
        return;
      }
      logger.info({ itemId: req.params.id }, "product soft-deleted");
      res.json({ ok: true });
    });

    app.post("/api/catalog/:id/photo", uploadProductPhoto.single("file"), (req, res) => {
      const existing = getItemById(this.deps.store.store_id, String(req.params.id));
      if (!existing) {
        res.status(404).json({ error: "producto no encontrado" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "no file — must be JPG/PNG/WebP up to 10 MB" });
        return;
      }
      // Drop a previously uploaded local photo; leave seeded http(s) URLs untouched.
      if (existing.photo_url && !isHttpUrl(existing.photo_url)) {
        rmSync(existing.photo_url, { force: true });
      }
      const updated: CatalogItem = { ...existing, photo_url: join(productsDir, req.file.filename) };
      updateItem(updated);
      logger.info({ itemId: updated.item_id }, "product photo uploaded");
      res.json(updated);
    });

    // Serve a product photo to the admin UI: redirect for seeded http URLs, file for uploads.
    app.get("/api/catalog/:id/photo", (req, res) => {
      const item = getItemById(this.deps.store.store_id, req.params.id);
      if (!item || !item.photo_url) {
        res.status(404).send("no photo");
        return;
      }
      if (isHttpUrl(item.photo_url)) {
        res.redirect(item.photo_url);
        return;
      }
      if (!existsSync(item.photo_url)) {
        res.status(404).send("no photo");
        return;
      }
      res.sendFile(item.photo_url);
    });

    // --- Store config (Tienda tab): values the bot reads for keyword replies ---
    app.get("/api/store", (_req, res) => {
      const store = getStoreById(this.deps.store.store_id);
      if (!store) {
        res.status(404).json({ error: "store not found" });
        return;
      }
      res.json(store);
    });

    app.put("/api/store", (req, res) => {
      const existing = getStoreById(this.deps.store.store_id);
      if (!existing) {
        res.status(404).json({ error: "store not found" });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      // Keep an existing value when the field is absent; empty string clears an optional one.
      const keep = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
      const opt = (v: unknown, fallback?: string) =>
        v === undefined ? fallback : typeof v === "string" && v.trim() ? v.trim() : undefined;

      let usd_rate = existing.usd_rate;
      let usd_rate_updated_at = existing.usd_rate_updated_at;
      if (b.usd_rate !== undefined) {
        if (b.usd_rate === null || b.usd_rate === "") {
          usd_rate = undefined;
          usd_rate_updated_at = undefined;
        } else {
          const n = Number(b.usd_rate);
          if (!Number.isFinite(n) || n < 0) {
            res.status(400).json({ error: "La tasa debe ser un número válido" });
            return;
          }
          if (n !== existing.usd_rate) usd_rate_updated_at = new Date().toISOString();
          usd_rate = n;
        }
      }

      const payments = (b.payments ?? {}) as Record<string, unknown>;
      const updated: Store = {
        ...existing, // preserves store_id, account_id, story_schedule, size_guide, categories
        store_name: keep(b.store_name, existing.store_name),
        owner_name: keep(b.owner_name, existing.owner_name),
        owner_whatsapp: keep(b.owner_whatsapp, existing.owner_whatsapp),
        hours: keep(b.hours, existing.hours),
        delivery_info: keep(b.delivery_info, existing.delivery_info),
        returns_policy: keep(b.returns_policy, existing.returns_policy),
        address: opt(b.address, existing.address),
        maps_url: opt(b.maps_url, existing.maps_url),
        payments: {
          pago_movil: opt(payments.pago_movil, existing.payments.pago_movil),
          zelle: opt(payments.zelle, existing.payments.zelle),
          binance: opt(payments.binance, existing.payments.binance),
        },
        usd_rate,
        usd_rate_updated_at,
      };
      upsertStore(updated);
      logger.info("store config saved");
      res.json(updated);
    });

    // --- Disconnect / unlink the bot ---
    app.post("/api/disconnect", async (_req, res) => {
      res.json({ ok: true }); // respond first; logout tears down the socket
      try {
        await this.deps.disconnect();
      } catch (err) {
        logger.error({ err }, "disconnect failed");
      }
    });

    // --- Contacts (numbers that have messaged the bot = Status audience) ---
    app.get("/api/contacts", (_req, res) => {
      res.json(listContacts(this.deps.store.store_id));
    });

    // --- Settings: story (Estados) daily schedule ---
    app.get("/api/settings/story-schedule", (_req, res) => {
      const store = getStoreById(this.deps.store.store_id);
      res.json(store?.story_schedule ?? DEFAULT_STORY_SCHEDULE);
    });

    app.put("/api/settings/story-schedule", (req, res) => {
      const enabled = Boolean(req.body?.enabled);
      const time = String(req.body?.time ?? "");
      if (!/^\d{1,2}:\d{2}$/.test(time)) {
        res.status(400).json({ error: "time must be HH:MM" });
        return;
      }
      const store = getStoreById(this.deps.store.store_id);
      if (!store) {
        res.status(404).json({ error: "store not found" });
        return;
      }
      const schedule: StorySchedule = { enabled, time };
      upsertStore({ ...store, story_schedule: schedule });
      logger.info(schedule, "story schedule saved");
      res.json(schedule);
    });

    // Publish stories to Status immediately (test / on-demand).
    app.post("/api/story/post-now", async (_req, res) => {
      const result = await this.deps.postStoryNow();
      res.json(result);
    });

    // --- Menus (flow builder config) ---
    app.get("/api/menus", (_req, res) => {
      res.json(getMenus(this.deps.store.store_id));
    });

    app.put("/api/menus", (req, res) => {
      const menus = req.body?.menus;
      if (!Array.isArray(menus)) {
        res.status(400).json({ error: "menus must be an array" });
        return;
      }
      saveMenus(this.deps.store.store_id, menus);
      logger.info({ count: menus.length }, "menus saved");
      res.json({ ok: true, count: menus.length });
    });

    // --- Static Angular app + SPA fallback ---
    if (existsSync(webDir)) {
      app.use(express.static(webDir));
      app.use((_req, res) => res.sendFile(indexHtml));
    } else {
      app.use((_req, res) =>
        res
          .status(200)
          .send("<h1>Web UI not built</h1><p>Run <code>npm run build:web</code>, then reload.</p>"),
      );
      logger.warn({ webDir }, "web UI build not found — run `npm run build:web`");
    }

    // Turn upload errors (too large, bad type) into a clean 400 instead of a 500.
    const onError: express.ErrorRequestHandler = (err, _req, res, _next) => {
      logger.error({ err }, "request error");
      res.status(400).json({ error: "No se pudo subir el archivo (revisa tipo y tamaño)." });
    };
    app.use(onError);

    app.listen(port, () => logger.info(`Web UI on http://localhost:${port}`));
  }
}
