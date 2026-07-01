import express, { type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";

/** Connection status as the browser needs it (QR already rendered to a data URL). */
export type WebStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "qr"; qrDataUrl: string }
  | { state: "open"; accountId: string };

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "..", "web", "dist", "store-admin", "browser");
const indexHtml = join(webDir, "index.html");

/**
 * Serves the Angular web UI and pushes live connection status over SSE.
 * Runs inside the bot process, so it shares the DB and transport.
 */
export class WebServer {
  private readonly clients = new Set<Response>();
  private status: WebStatus = { state: "idle" };

  /** Update the current status and push it to every connected browser. */
  setStatus(status: WebStatus): void {
    this.status = status;
    const frame = `data: ${JSON.stringify(status)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }

  listen(port: number): void {
    const app = express();

    // Server-Sent Events: send the current status now, then stream updates.
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

    if (existsSync(webDir)) {
      app.use(express.static(webDir));
      // SPA fallback: any other route serves index.html.
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
