import express, { type Response } from "express";
import multer from "multer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { containedPath } from "../domain/uploads.js";
import { ensureThumbnail, removeThumbnail } from "../services/thumbnails.js";
import { logger } from "../logger.js";
import type {
  Asset,
  AssetCategory,
  CatalogItem,
  Order,
  OrderStatus,
  Store,
  Story,
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
  listStories,
  getStory,
  saveStory,
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
import { validateFlow } from "../engine/validateFlow.js";
import { canTransition, nextStatuses } from "../domain/orderStatus.js";
import type { StoryPostResult } from "../services/storyScheduler.js";
import { deleteStoryAndMedia, discardDroppedMedia } from "../services/stories.js";
import { parseTimeMinutes } from "../domain/storySchedule.js";

/** Connection status as the browser needs it (QR already rendered to a data URL). */
export type WebStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "qr"; qrDataUrl: string }
  | { state: "open"; accountId: string };

/** What the web server needs from the rest of the app. */
export interface WebDeps {
  /** Read the store fresh on every use — PUT /api/store edits the very values
   *  (name, rate, payment details) that customer messages quote, and a snapshot
   *  taken at boot would keep serving the old ones until a restart. */
  getStore: () => Store;
  /** Send a WhatsApp message (used to notify the customer on payment verification). */
  sendMessage: (to: string, body: string) => Promise<void>;
  /** Unlink the bot from WhatsApp (shows a fresh QR to re-pair). */
  disconnect: () => Promise<void>;
  /** Publish one scheduled story to WhatsApp Status right now. */
  postStoryNow: (storyId: string) => Promise<StoryPostResult>;
}


const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "..", "web", "dist", "store-admin", "browser");
const indexHtml = join(webDir, "index.html");
const { assetsDir, productsDir, receiptsDir } = config;

/**
 * Allowed upload types, each mapped to the extension we store it under. The
 * extension comes from this table rather than from the client's filename: an
 * HTML file declared as image/png but named "x.html" would otherwise be written
 * as .html and then served as text/html from the admin's own origin.
 */
const ASSET_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  // A Status can be a short video. Only MP4: it is what WhatsApp itself produces and
  // what every phone camera writes, and each extra container is another decoder.
  "video/mp4": ".mp4",
};
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** WhatsApp truncates a Status caption around here. */
const MAX_CAPTION = 700;

/** A real calendar date in "YYYY-MM-DD" — not "2026-02-31", which Date happily rolls over. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const MAX_ASSET_BYTES = 15 * 1024 * 1024;
/** Video needs more room than a photo; WhatsApp itself caps a Status video at ~16MB. */
const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Multer: store uploads with a random name and an extension we chose ourselves. */
const uploadAsset = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assetsDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${ASSET_EXT[file.mimetype] ?? ""}`),
  }),
  // The limit has to cover the largest type multer will accept; the per-type check
  // below is what actually rejects an oversized image.
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in ASSET_EXT),
});

/** Whether an accepted upload is within the limit for its own type. */
function withinTypeLimit(file: { mimetype: string; size: number }): boolean {
  const max = file.mimetype.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES;
  return file.size <= max;
}

/** Multer for product photos: images only, stored under uploads/products. */
const uploadProductPhoto = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, productsDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${IMAGE_EXT[file.mimetype] ?? ""}`),
  }),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_EXT),
});

/** Serve a stored upload without letting a browser reinterpret its type. */
function sendStoredFile(res: Response, path: string): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(path);
}

const isHttpUrl = (s: string): boolean => /^https?:\/\//.test(s);

/**
 * Resolve a stored product photo, refusing anything outside uploads/products. Values
 * come from the DB, and a bad row must never let us read or delete an arbitrary file,
 * so every filesystem use of photo_url goes through here.
 */
function localPhotoPath(photoUrl: string): string | null {
  return containedPath(productsDir, photoUrl);
}

/** The same guard for receipts, which previously had none at all. */
function localReceiptPath(receiptUrl: string | null | undefined): string | null {
  return containedPath(receiptsDir, receiptUrl);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const TOKEN_COOKIE = "admin_token";
const TOKEN_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Read a single cookie, so the token gate needs no cookie-parser dependency. */
function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** Compare in constant time so a wrong token leaks no prefix information. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
    // Never taken from the request: photo_url is a filesystem path we read and
    // delete, so only POST /api/catalog/:id/photo may ever set it.
    photo_url: existing?.photo_url ?? "",
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

  /** The store as it is right now, never a boot-time copy. */
  private get store(): Store {
    return this.deps.getStore();
  }

  private get storeId(): string {
    return this.store.store_id;
  }

  /** Update the current status and push it to every connected browser. */
  setStatus(status: WebStatus): void {
    this.status = status;
    const frame = `data: ${JSON.stringify(status)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }

  /** Look up an order, scoped to this instance's store. */
  private findOrder(id: string): Order | undefined {
    const order = getOrder(id);
    return order && order.store_id === this.storeId ? order : undefined;
  }

  /**
   * The single path every status change takes: look up, check the transition is
   * legal, persist, notify the customer. Routing all of verify/cancel/ship/deliver
   * through here is what stops a finished order being moved again.
   */
  /**
   * Validate a story payload from the composer.
   *
   * The messages are Spanish and user-facing — the composer shows them verbatim rather
   * than mapping codes to copy of its own.
   */
  private parseStoryInput(
    body: unknown,
  ):
    | { value: Omit<Story, "id" | "store_id" | "last_posted_at" | "created_at"> }
    | { error: string } {
    const b = (body ?? {}) as Record<string, unknown>;

    const mode = b["mode"];
    if (mode !== "daily" && mode !== "weekly" && mode !== "once") {
      return { error: "Elige cuándo se publica." };
    }

    const postTime = String(b["post_time"] ?? "");
    if (parseTimeMinutes(postTime) === null) return { error: "La hora no es válida." };

    const weekdays = Array.isArray(b["weekdays"])
      ? [
          ...new Set(
            (b["weekdays"] as unknown[])
              .map(Number)
              .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7),
          ),
        ].sort((x, y) => x - y)
      : [];
    if (mode === "weekly" && weekdays.length === 0) {
      return { error: "Elige al menos un día de la semana." };
    }

    const postDate = typeof b["post_date"] === "string" ? b["post_date"] : null;
    if (mode === "once" && (!postDate || !isCalendarDate(postDate))) {
      return { error: "Elige la fecha de publicación." };
    }

    const mediaIds = Array.isArray(b["media"]) ? (b["media"] as unknown[]).map(String) : [];
    if (mediaIds.length === 0) return { error: "Agrega al menos una imagen o un video." };
    if (new Set(mediaIds).size !== mediaIds.length) {
      return { error: "Hay un archivo repetido." };
    }
    for (const id of mediaIds) {
      const asset = getAsset(id);
      if (!asset || asset.store_id !== this.storeId || asset.category !== "story") {
        return { error: "Uno de los archivos ya no está disponible." };
      }
    }

    const caption = String(b["caption"] ?? "").trim();
    if (caption.length > MAX_CAPTION) {
      return { error: `El texto no puede pasar de ${MAX_CAPTION} caracteres.` };
    }

    return {
      value: {
        caption,
        mode,
        weekdays: mode === "weekly" ? weekdays : [],
        post_date: mode === "once" ? postDate : null,
        post_time: postTime,
        // Only a one-time story may clean up after itself; on a repeating one this
        // would delete the media it needs for the next run.
        delete_after: mode === "once" && Boolean(b["delete_after"]),
        enabled: b["enabled"] === undefined ? true : Boolean(b["enabled"]),
        // Position is the array order, so reordering the strip is just a re-save.
        media: mediaIds.map((asset_id, position) => ({ asset_id, position })),
      },
    };
  }

  private async advance(
    res: Response,
    id: string,
    to: OrderStatus,
    message: (order: Order, store: Store) => string,
  ): Promise<void> {
    const order = this.findOrder(id);
    if (!order) {
      res.status(404).json({ error: "order not found" });
      return;
    }
    if (!canTransition(order.status, to)) {
      res.status(409).json({
        error: `Un pedido en "${order.status}" no puede pasar a "${to}".`,
        allowed: nextStatuses(order.status),
      });
      return;
    }
    const updated = { ...order, status: to };
    updateOrder(updated);
    const notified = await this.trySend(order.customer_wa, message(updated, this.store));
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

  listen(port: number, host: string = config.webHost): void {
    if (!LOOPBACK_HOSTS.has(host) && !config.adminToken) {
      throw new Error(
        `WEB_HOST=${host} would expose the admin API (orders, customer numbers, ` +
          `payment details, message sending) to the network. Set ADMIN_TOKEN in .env first.`,
      );
    }
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(productsDir, { recursive: true });
    mkdirSync(receiptsDir, { recursive: true });
    const app = express();
    app.use(express.json());

    // --- Shared-secret gate (only when ADMIN_TOKEN is set) ---
    // The API has no per-user auth, so this is the single boundary protecting it.
    // `?token=` is a one-time handshake that moves the secret into an httpOnly
    // cookie, which keeps the SPA's own requests working without a login screen.
    const adminToken = config.adminToken;
    if (adminToken) {
      app.use((req, res, next) => {
        const fromQuery = typeof req.query.token === "string" ? req.query.token : "";
        if (fromQuery && tokenMatches(fromQuery, adminToken)) {
          res.cookie(TOKEN_COOKIE, adminToken, {
            httpOnly: true,
            sameSite: "lax",
            maxAge: TOKEN_COOKIE_MAX_AGE,
          });
          res.redirect(req.path);
          return;
        }
        const given = req.get("x-admin-token") ?? readCookie(req.headers.cookie, TOKEN_COOKIE) ?? "";
        if (tokenMatches(given, adminToken)) {
          next();
          return;
        }
        logger.warn({ ip: req.ip, path: req.path }, "rejected unauthenticated admin request");
        res.status(401).json({ error: "unauthorized" });
      });
    }

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
      res.json(listOrders(this.storeId));
    });

    app.get("/api/orders/:id/receipt", (req, res) => {
      const order = getOrder(req.params.id);
      if (!order || order.store_id !== this.storeId) {
        res.status(404).send("no receipt");
        return;
      }
      const file = localReceiptPath(order.receipt_url);
      if (!file || !existsSync(file)) {
        res.status(404).send("no receipt");
        return;
      }
      // The filename is deterministic per order, so a corrected comprobante reuses this
      // URL. no-cache makes the browser revalidate rather than serve a stale image —
      // sendFile already sets ETag and Last-Modified, so the common case is a cheap 304.
      // (A ?v= cache-buster would work too, but the order list is refetched every ten
      // seconds, so it would re-download every thumbnail on every poll.)
      res.setHeader("Cache-Control", "no-cache");
      sendStoredFile(res, file);
    });

    app.post("/api/orders/:id/verify", async (req, res) => {
      await this.advance(res, req.params.id, "confirmed", customerPaymentConfirmedMessage);
    });

    // Send the customer a check-in (does not change the order).
    app.post("/api/orders/:id/remind", async (req, res) => {
      const order = this.findOrder(req.params.id);
      if (!order) {
        res.status(404).json({ error: "order not found" });
        return;
      }
      const notified = await this.trySend(order.customer_wa, customerCheckInMessage(order, this.store));
      logger.info({ orderId: order.order_id, notified }, "reminder sent");
      res.json({ notified });
    });

    // Cancel an order and tell the customer.
    app.post("/api/orders/:id/cancel", async (req, res) => {
      await this.advance(res, req.params.id, "cancelled", customerOrderCancelledMessage);
    });

    // Fulfillment: confirmed → shipped.
    app.post("/api/orders/:id/ship", async (req, res) => {
      await this.advance(res, req.params.id, "shipped", customerShippedMessage);
    });

    // Fulfillment: shipped → delivered.
    app.post("/api/orders/:id/deliver", async (req, res) => {
      await this.advance(res, req.params.id, "delivered", customerDeliveredMessage);
    });

    // --- Assets (catalogue documents and Status images) ---
    app.get("/api/assets", (_req, res) => {
      res.json(listAssets(this.storeId));
    });

    app.post("/api/assets/:category", uploadAsset.single("file"), (req, res) => {
      const category = req.params.category as AssetCategory;
      if (category !== "catalog" && category !== "story") {
        res.status(400).json({ error: "invalid category" });
        return;
      }
      if (!req.file) {
        res
          .status(400)
          .json({ error: `Archivo no válido — usa JPG, PNG, WebP, PDF o MP4.` });
        return;
      }
      // A video is only ever a Status. A catalogue file is something the bot sends to a
      // customer in chat, where an MP4 is not what "mi catálogo" means.
      if (req.file.mimetype.startsWith("video/") && category !== "story") {
        rmSync(join(assetsDir, req.file.filename), { force: true });
        res.status(400).json({ error: "Los videos solo se pueden usar como Estado." });
        return;
      }
      if (!withinTypeLimit(req.file)) {
        rmSync(join(assetsDir, req.file.filename), { force: true });
        const mb = Math.round(MAX_ASSET_BYTES / 1024 / 1024);
        res.status(400).json({ error: `La imagen no puede pesar más de ${mb} MB.` });
        return;
      }
      const asset: Asset = {
        id: randomUUID(),
        store_id: this.storeId,
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
      if (!asset || asset.store_id !== this.storeId) {
        res.status(404).send("not found");
        return;
      }
      sendStoredFile(res, join(assetsDir, asset.filename));
    });

    /**
      * The thumbnail, generated on first request and cached beside the original.
      *
      * 404 when the asset cannot have one (a PDF), which the UI already handles by
      * drawing its file icon.
      */
    app.get("/api/assets/:id/thumb", async (req, res) => {
      const asset = getAsset(req.params.id);
      if (!asset || asset.store_id !== this.storeId) {
        res.status(404).send("not found");
        return;
      }
      const thumb = await ensureThumbnail(assetsDir, asset.filename, asset.mimetype);
      if (!thumb) {
        // Cache the miss briefly. Without it a PDF — or an image sharp cannot decode —
        // re-runs generation on every request, on every page load, forever.
        res.setHeader("Cache-Control", "private, max-age=300");
        res.status(404).send("no thumbnail");
        return;
      }
      // Content-addressed by the asset's own filename, which never changes for a given
      // upload, so it can be cached hard. private: the route is token-gated, and a shared
      // intermediary has no business holding an authenticated image for a year.
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      sendStoredFile(res, thumb);
    });

    app.delete("/api/assets/:id", (req, res) => {
      const asset = getAsset(req.params.id);
      if (!asset || asset.store_id !== this.storeId) {
        res.status(404).json({ error: "not found" });
        return;
      }
      rmSync(join(assetsDir, asset.filename), { force: true });
      removeThumbnail(assetsDir, asset.filename);
      deleteAsset(asset.id);
      logger.info({ id: asset.id }, "asset deleted");
      res.json({ ok: true });
    });

    // --- Catalog (products) — DB is the source of truth the bot reads each message ---
    app.get("/api/catalog", (_req, res) => {
      res.json(listAllItems(this.storeId));
    });

    app.post("/api/catalog", (req, res) => {
      let item: CatalogItem;
      try {
        item = buildItemFromBody(req.body, this.storeId);
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
      const existing = getItemById(this.storeId, req.params.id);
      if (!existing) {
        res.status(404).json({ error: "producto no encontrado" });
        return;
      }
      let item: CatalogItem;
      try {
        item = buildItemFromBody(req.body, this.storeId, existing);
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
      if (!softDeleteItem(this.storeId, req.params.id)) {
        res.status(404).json({ error: "producto no encontrado" });
        return;
      }
      logger.info({ itemId: req.params.id }, "product soft-deleted");
      res.json({ ok: true });
    });

    app.post("/api/catalog/:id/photo", uploadProductPhoto.single("file"), (req, res) => {
      const existing = getItemById(this.storeId, String(req.params.id));
      if (!existing) {
        res.status(404).json({ error: "producto no encontrado" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: `no file — must be JPG/PNG/WebP up to ${MAX_PHOTO_BYTES / 1024 / 1024} MB` });
        return;
      }
      // Drop a previously uploaded local photo; leave seeded http(s) URLs untouched.
      if (existing.photo_url && !isHttpUrl(existing.photo_url)) {
        const previous = localPhotoPath(existing.photo_url);
        if (previous) rmSync(previous, { force: true });
        else logger.warn({ itemId: existing.item_id }, "ignoring photo_url outside uploads/products");
      }
      // Bare filename, rejoined with productsDir at serve time.
      const updated: CatalogItem = { ...existing, photo_url: req.file.filename };
      updateItem(updated);
      logger.info({ itemId: updated.item_id }, "product photo uploaded");
      res.json(updated);
    });

    // Serve a product photo to the admin UI: redirect for seeded http URLs, file for uploads.
    app.get("/api/catalog/:id/photo", (req, res) => {
      const item = getItemById(this.storeId, req.params.id);
      if (!item || !item.photo_url) {
        res.status(404).send("no photo");
        return;
      }
      if (isHttpUrl(item.photo_url)) {
        res.redirect(item.photo_url);
        return;
      }
      const file = localPhotoPath(item.photo_url);
      if (!file || !existsSync(file)) {
        res.status(404).send("no photo");
        return;
      }
      sendStoredFile(res, file);
    });

    // --- Store config (Tienda tab): values the bot reads for keyword replies ---
    app.get("/api/store", (_req, res) => {
      const store = getStoreById(this.storeId);
      if (!store) {
        res.status(404).json({ error: "store not found" });
        return;
      }
      res.json(store);
    });

    app.put("/api/store", (req, res) => {
      const existing = getStoreById(this.storeId);
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
      res.json(listContacts(this.storeId));
    });

    // --- Stories (scheduled Estados) ---
    app.get("/api/stories", (_req, res) => {
      res.json(listStories(this.storeId));
    });

    app.post("/api/stories", (req, res) => {
      const parsed = this.parseStoryInput(req.body);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const story: Story = {
        ...parsed.value,
        id: randomUUID(),
        store_id: this.storeId,
        last_posted_at: null,
        created_at: new Date().toISOString(),
      };
      saveStory(story);
      logger.info({ story: story.id, media: story.media.length }, "story created");
      res.json(story);
    });

    app.put("/api/stories/:id", (req, res) => {
      const existing = getStory(req.params.id);
      if (!existing || existing.store_id !== this.storeId) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const parsed = this.parseStoryInput(req.body);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      // The guard survives an edit — otherwise saving a typo in the caption at 09:05
      // would let the story post to every customer a second time.
      const story: Story = {
        ...parsed.value,
        id: existing.id,
        store_id: existing.store_id,
        last_posted_at: existing.last_posted_at,
        created_at: existing.created_at,
      };
      saveStory(story);
      // The media list is replaced wholesale, so anything the owner removed in the
      // composer has to be deleted here or it becomes an unreachable file on disk.
      discardDroppedMedia(
        existing,
        story.media.map((m) => m.asset_id),
        assetsDir,
      );
      logger.info({ story: story.id }, "story updated");
      res.json(story);
    });

    app.delete("/api/stories/:id", (req, res) => {
      const story = getStory(req.params.id);
      if (!story || story.store_id !== this.storeId) {
        res.status(404).json({ error: "not found" });
        return;
      }
      // Media are not reachable on their own, so they go with the story or they leak.
      const removed = deleteStoryAndMedia(story.id, assetsDir);
      res.json({ ok: true, removed });
    });

    // Publish one story to Status immediately (test / on-demand).
    app.post("/api/stories/:id/post-now", async (req, res) => {
      const story = getStory(req.params.id);
      if (!story || story.store_id !== this.storeId) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const result = await this.deps.postStoryNow(story.id);
      res.json(result);
    });

    // --- Menus (flow builder config) ---
    app.get("/api/menus", (_req, res) => {
      res.json(getMenus(this.storeId));
    });

    app.put("/api/menus", (req, res) => {
      const menus = req.body?.menus;
      if (!Array.isArray(menus)) {
        res.status(400).json({ error: "menus must be an array" });
        return;
      }
      // Validate the flow: block the save on errors, allow it with warnings.
      const issues = validateFlow(menus);
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length) {
        res.status(400).json({ error: "El flujo tiene errores", issues });
        return;
      }
      saveMenus(this.storeId, menus);
      logger.info({ count: menus.length, warnings: issues.length }, "menus saved");
      res.json({ ok: true, count: menus.length, issues });
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

    // Only upload problems are the client's fault; anything else is a real
    // server error and must not be reported as a bad request (a failed DB write
    // used to surface as "could not upload the file").
    const onError: express.ErrorRequestHandler = (err, _req, res, _next) => {
      logger.error({ err }, "request error");
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: "No se pudo subir el archivo (revisa tipo y tamaño)." });
        return;
      }
      res.status(500).json({ error: "Error interno del servidor." });
    };
    app.use(onError);

    app.listen(port, host, () => {
      const url = `http://${LOOPBACK_HOSTS.has(host) ? "localhost" : host}:${port}`;
      logger.info(config.adminToken ? `Web UI on ${url}/?token=<ADMIN_TOKEN>` : `Web UI on ${url}`);
    });
  }
}
