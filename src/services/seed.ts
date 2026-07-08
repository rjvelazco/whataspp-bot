import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogItem, FlowMenu, Store } from "../domain/types.js";
import { countItems, getMenus, getStoreById, replaceCatalog, saveMenus, upsertStore } from "../db/repositories.js";
import { logger } from "../logger.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

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
    const store = JSON.parse(
      readFileSync(join(dataDir, `${storeId}.store.json`), "utf8"),
    ) as Store;
    upsertStore(store);
    logger.info({ storeId }, "seeded store config");
  }

  // Seed the catalog ONCE too, for the same reason.
  if (countItems(storeId) === 0) {
    const items = JSON.parse(
      readFileSync(join(dataDir, `${storeId}.catalog.json`), "utf8"),
    ) as CatalogItem[];
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
  return getStoreById(storeId)!;
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
