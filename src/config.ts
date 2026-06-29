import "dotenv/config";
import { resolve } from "node:path";

/** Runtime configuration, loaded once from environment (.env). */
export const config = {
  storeId: process.env.STORE_ID ?? "novamoda",
  dbPath: resolve(process.env.DB_PATH ?? "./store-bot.sqlite"),
  authDir: resolve(process.env.AUTH_DIR ?? "./auth"),
  uploadsDir: resolve(process.env.UPLOADS_DIR ?? "./uploads"),
  logLevel: process.env.LOG_LEVEL ?? "info",
  handoffPauseHours: Number(process.env.HANDOFF_PAUSE_HOURS ?? "12"),
};

export type Config = typeof config;
