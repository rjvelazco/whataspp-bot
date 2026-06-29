import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogItem, Store } from "../domain/types.js";
import { getStoreById, replaceCatalog, upsertStore } from "../db/repositories.js";
import { logger } from "../logger.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

/**
 * Load a store's config + catalog from src/data/<storeId>.*.json into SQLite.
 * Idempotent: safe to run on every boot. Preserves an existing account binding.
 */
export function seedStore(storeId: string): Store {
  const store = JSON.parse(
    readFileSync(join(dataDir, `${storeId}.store.json`), "utf8"),
  ) as Store;
  const items = JSON.parse(
    readFileSync(join(dataDir, `${storeId}.catalog.json`), "utf8"),
  ) as CatalogItem[];

  // Don't clobber an account_id that was bound at runtime in a previous session.
  const existing = getStoreById(storeId);
  if (existing?.account_id) store.account_id = existing.account_id;

  upsertStore(store);
  replaceCatalog(storeId, items);
  logger.info({ storeId, items: items.length }, "seeded store config + catalog");
  return store;
}
