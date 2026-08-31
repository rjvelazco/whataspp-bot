import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { migrateUploadPaths } from "./migrateUploads.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Shared SQLite connection. Schema is applied on first import (migrate-on-boot). */
export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = readFileSync(join(here, "schema.sql"), "utf8");
db.exec(schema);

// Lightweight migrations for DBs created before a column existed.
const convCols = (db.prepare(`PRAGMA table_info(conversations)`).all() as { name: string }[]).map(
  (c) => c.name,
);
if (!convCols.includes("menu_key")) {
  db.exec(`ALTER TABLE conversations ADD COLUMN menu_key TEXT`);
}

/**
 * Rewrite legacy absolute file paths to bare filenames, and relocate the files.
 *
 * Called explicitly from startup rather than run on import: it mutates the filesystem,
 * and as a module-load side effect any stray import of the repositories — a script, a
 * one-off tsx invocation, a test that forgot to point UPLOADS_DIR somewhere safe — would
 * quietly rename files under the real uploads directory. Idempotent, so calling it on
 * every boot is fine.
 */
export function migrateStoredUploads(): void {
  const migrated = migrateUploadPaths(db, {
    uploadsDir: config.uploadsDir,
    receiptsDir: config.receiptsDir,
  });
  if (migrated.receipts || migrated.photos || migrated.moved || migrated.failed) {
    logger.info(migrated, "migrated stored upload paths to bare filenames");
  }
}
