import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogItem, FlowMenu, Store } from "../domain/types.js";
import { countItems, getMenus, getStoreById, replaceCatalog, saveMenus, upsertStore } from "../db/repositories.js";
import { logger } from "../logger.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

/**
 * Read one of a store's seed files. Named error instead of a raw ENOENT stack:
 * adding a store is the moment this fails, and "no such file or directory" gives
 * the operator nothing to act on.
 */
function readSeedFile<T>(path: string, what: string): T {
  if (!existsSync(path)) {
    throw new Error(`Missing ${what} for this store: ${path}\nCreate it, or set STORE_ID to a store that has one.`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    throw new Error(`${what} is not valid JSON: ${path} (${(err as Error).message})`);
  }
}

/**
 * Load a store's config + catalog from src/data/<storeId>.*.json into SQLite.
 * Idempotent + DB-authoritative: the JSON files seed a store ONCE. After the first
 * boot the DB wins, so admin edits (Tienda values, products, menus, bound account,
 * Status schedule) survive restarts. Re-import by deleting the store's rows first.
 */
export function seedStore(storeId: string): Store {
  const existing = getStoreById(storeId);
  if (existing) {
    logger.info({ storeId }, "store already configured — kept DB copy");
  } else {
    const store = readSeedFile<Store>(join(dataDir, `${storeId}.store.json`), "store config");
    upsertStore(store);
    logger.info({ storeId }, "seeded store config");
  }

  // Seed the catalog ONCE too, for the same reason.
  if (countItems(storeId) === 0) {
    const items = readSeedFile<CatalogItem[]>(join(dataDir, `${storeId}.catalog.json`), "catalog");
    replaceCatalog(storeId, items);
    logger.info({ storeId, items: items.length }, "seeded catalog");
  }

  // Seed the flow-builder menus ONCE — never clobber edits saved from the builder.
  const menusPath = join(dataDir, `${storeId}.menus.json`);
  if (existsSync(menusPath) && getMenus(storeId).length === 0) {
    const menus = JSON.parse(readFileSync(menusPath, "utf8")) as FlowMenu[];
    saveMenus(storeId, menus);
    logger.info({ storeId, menus: menus.length }, "seeded default menus");
  }

  // One-off migration: move legacy show_category `target` onto `value` so the
  // option/action model is consistent (target now means "menu key" only).
  const persisted = getMenus(storeId);
  if (persisted.length) {
    const { menus: migrated, changed } = migrateShowCategoryValue(persisted);
    if (changed) {
      saveMenus(storeId, migrated);
      logger.info({ storeId }, "migrated show_category options to value");
    }
  }

  // Return the authoritative store (freshly seeded or the kept DB copy).
  const seeded = getStoreById(storeId);
  if (!seeded) throw new Error(`Store "${storeId}" is still missing after seeding — check the DB is writable.`);
  return seeded;
}

/**
 * Legacy menus stored the show_category's category in `target`. Move it to
 * `value` (and drop the stray target). Pure + idempotent — returns whether it
 * changed anything so callers only persist when needed.
 */
export function migrateShowCategoryValue(menus: FlowMenu[]): {
  menus: FlowMenu[];
  changed: boolean;
} {
  let changed = false;
  const migrated = menus.map((m) => ({
    ...m,
    options: m.options.map((o) => {
      if (o.action === "show_category" && o.value === undefined && o.target !== undefined) {
        changed = true;
        return { label: o.label, action: o.action, value: o.target };
      }
      return o;
    }),
  }));
  return { menus: migrated, changed };
}
