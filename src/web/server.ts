import express, { type Response } from "express";
import multer from "multer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Asset, AssetCategory, Order, OrderStatus, Store } from "../domain/types.js";
import {
  createAsset,
  deleteAsset,
  getAsset,
  getMenus,
  getOrder,
  listAssets,
  listOrders,
  saveMenus,
  updateOrder,
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
}

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "..", "web", "dist", "store-admin", "browser");
const indexHtml = join(webDir, "index.html");
const assetsDir = join(config.uploadsDir, "assets");

const ALLOWED_ASSET_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/** Multer: store uploads under uploads/assets with a random, extension-preserving name. */
const uploadAsset = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assetsDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_ASSET_TYPES.has(file.mimetype)),
});

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
