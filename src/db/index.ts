import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

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
