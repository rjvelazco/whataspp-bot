import "dotenv/config";
import { resolve } from "node:path";

/** Runtime configuration, loaded once from environment (.env). */
export const config = {
  storeId: process.env.STORE_ID ?? "novamoda",
  dbPath: resolve(process.env.DB_PATH ?? "./store-bot.sqlite"),
  authDir: resolve(process.env.AUTH_DIR ?? "./auth"),
  uploadsDir: resolve(process.env.UPLOADS_DIR ?? "./uploads"),
  logLevel: process.env.LOG_LEVEL ?? "info",
  /** Level for Baileys' own internal logs. Defaults to "silent" — its decrypt
   * failures for Status/other-recipient messages are expected noise. Set to
   * "warn"/"info" to debug the WhatsApp connection. */
  waLogLevel: process.env.WA_LOG_LEVEL ?? "silent",
  handoffPauseHours: Number(process.env.HANDOFF_PAUSE_HOURS ?? "12"),
  /** If set (bot's number, digits only w/ country code), pair via code instead of QR. */
  pairPhone: (process.env.PAIR_PHONE ?? "").replace(/\D/g, ""),
  /** Port for the web UI (QR pairing + future admin dashboard). */
  webPort: Number(process.env.WEB_PORT ?? "3000"),
  /** Interface the web UI binds to. Loopback by default: the admin API can read
   * every order, rewrite the store's payment details and message customers, so it
   * must not be reachable from the network unless an ADMIN_TOKEN is set. */
  webHost: process.env.WEB_HOST ?? "127.0.0.1",
  /** Shared secret guarding the admin UI + API. Required whenever WEB_HOST is not
   * loopback. Open http://<host>:<port>/?token=<value> once per browser; it is then
   * kept in an httpOnly cookie. */
  adminToken: process.env.ADMIN_TOKEN ?? "",
};

export type Config = typeof config;
