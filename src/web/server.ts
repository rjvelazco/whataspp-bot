import express, { type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import type { Store } from "../domain/types.js";
import { getOrder, listOrders, updateOrder } from "../db/repositories.js";
import {
  customerCheckInMessage,
  customerOrderCancelledMessage,
  customerPaymentConfirmedMessage,
} from "../services/notify.js";
import type { Order } from "../domain/types.js";

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

    app.listen(port, () => logger.info(`Web UI on http://localhost:${port}`));
  }
}
