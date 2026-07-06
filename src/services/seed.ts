import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogItem, FlowMenu, Store } from "../domain/types.js";
import { getMenus, getStoreById, replaceCatalog, saveMenus, upsertStore } from "../db/repositories.js";
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

  // Don't clobber values set at runtime in a previous session (bound account,
  // story schedule edited from the admin panel).
  const existing = getStoreById(storeId);
  if (existing?.account_id) store.account_id = existing.account_id;
  if (existing?.story_schedule) store.story_schedule = existing.story_schedule;

  upsertStore(store);
  replaceCatalog(storeId, items);
  logger.info({ storeId, items: items.length }, "seeded store config + catalog");

  // Seed the flow-builder menus ONCE — never clobber edits saved from the builder.
  const menusPath = join(dataDir, `${storeId}.menus.json`);
  if (existsSync(menusPath) && getMenus(storeId).length === 0) {
    const menus = JSON.parse(readFileSync(menusPath, "utf8")) as FlowMenu[];
    saveMenus(storeId, menus);
    logger.info({ storeId, menus: menus.length }, "seeded default menus");
  }

  return store;
}
