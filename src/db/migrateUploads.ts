import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { isHttpUrl, isLegacyPath, toStoredFilename } from "../domain/uploads.js";
import { logger } from "../logger.js";

/**
 * One-time backfill: rewrite stored file paths to bare filenames.
 *
 * Receipts and product photos used to be persisted as absolute paths, resolved against
 * the process CWD at boot. Moving the project directory therefore stranded every one of
 * them — the files were still on disk, but the path in the database pointed somewhere
 * that no longer existed, so the receipt route 404'd and the UI painted a broken image.
 *
 * Receipts also move from uploads/ into uploads/receipts/, so they sit alongside
 * uploads/assets and uploads/products instead of loose in the root.
 *
 * Note both `receipt_url` and `photo_url` live **only** inside `data_json`; neither has a
 * column of its own. That is why writing the blob directly is sufficient here. The fields
 * that *are* duplicated between a column and the blob — `orders.status`,
 * `catalog_items.active`, `code` and `category` — are untouched by this migration.
 *
 * Idempotent, and every filesystem step is guarded: a row that cannot be relocated is
 * logged and left rather than taking the process down on boot.
 */
export function migrateUploadPaths(
  db: Database.Database,
  dirs: { uploadsDir: string; receiptsDir: string },
): { receipts: number; photos: number; moved: number; failed: number } {
  const counts = { receipts: 0, photos: 0, moved: 0, failed: 0 };

  const orders = db.prepare(`SELECT order_id, data_json FROM orders`).all() as {
    order_id: string;
    data_json: string;
  }[];
  const updateOrder = db.prepare(`UPDATE orders SET data_json = ? WHERE order_id = ?`);

  const items = db.prepare(`SELECT item_id, data_json FROM catalog_items`).all() as {
    item_id: string;
    data_json: string;
  }[];
  const updateItem = db.prepare(`UPDATE catalog_items SET data_json = ? WHERE item_id = ?`);

  // One transaction: a crash partway through leaves the table as it was, rather than
  // half-rewritten.
  db.transaction(() => {
    for (const row of orders) {
      let order: Record<string, unknown> & { receipt_url?: string | null };
      try {
        order = JSON.parse(row.data_json);
      } catch {
        logger.warn({ orderId: row.order_id }, "skipping order with unparseable data_json");
        counts.failed += 1;
        continue;
      }
      if (!isLegacyPath(order.receipt_url)) continue;
      const filename = toStoredFilename(order.receipt_url);
      if (!filename) continue;

      if (relocate(order.receipt_url as string, filename, dirs, row.order_id)) counts.moved += 1;

      // Rewrite even when the file could not be found: a bare name that 404s renders the
      // designed "sin comprobante" placeholder, where a stale absolute path renders a
      // broken image and leaks the old host layout through the API. Spreading `order`
      // keeps every other field in the blob exactly as it was.
      updateOrder.run(JSON.stringify({ ...order, receipt_url: filename }), row.order_id);
      counts.receipts += 1;
    }

    for (const row of items) {
      let item: Record<string, unknown> & { photo_url?: string | null };
      try {
        item = JSON.parse(row.data_json);
      } catch {
        logger.warn({ itemId: row.item_id }, "skipping item with unparseable data_json");
        counts.failed += 1;
        continue;
      }
      const photo = item.photo_url;
      // Seeded products carry remote URLs, which are served by redirect and must stay.
      if (!photo || isHttpUrl(photo) || !isLegacyPath(photo)) continue;
      const filename = toStoredFilename(photo);
      if (!filename) continue;
      updateItem.run(JSON.stringify({ ...item, photo_url: filename }), row.item_id);
      counts.photos += 1;
    }
  })();

  return counts;
}

/**
 * Move a receipt into uploads/receipts/, if it can be found.
 *
 * Two candidate sources, in order: the path actually recorded in the row, and the same
 * filename in the current uploads root. The recorded path matters — if UPLOADS_DIR itself
 * changed, which is exactly the situation this migration exists for, that is the only
 * place the file still is.
 *
 * Never throws. A filesystem error here used to be able to abort the whole boot, and it
 * would have done so identically on every retry.
 */
function relocate(
  storedValue: string,
  filename: string,
  dirs: { uploadsDir: string; receiptsDir: string },
  orderId: string,
): boolean {
  const target = join(dirs.receiptsDir, filename);
  try {
    if (existsSync(target)) {
      // Never clobber. If a copy is also still sitting in the old location, say so —
      // otherwise an operator has no trace that two candidate files existed.
      const legacy = join(dirs.uploadsDir, filename);
      if (existsSync(legacy)) {
        logger.warn({ orderId, legacy }, "receipt already migrated; a stale copy remains");
      }
      return false;
    }

    const candidates = [storedValue, join(dirs.uploadsDir, filename)];
    const source = candidates.find((c) => {
      try {
        return existsSync(c) && statSync(c).isFile();
      } catch {
        return false;
      }
    });

    if (!source) {
      logger.warn({ orderId, storedValue }, "receipt file not found; rewriting the row anyway");
      return false;
    }

    mkdirSync(dirs.receiptsDir, { recursive: true });
    renameSync(source, target);
    return true;
  } catch (err) {
    // EXDEV across devices, EACCES, a directory in the way — log and leave the file be.
    logger.warn({ err, orderId, storedValue }, "could not move receipt into uploads/receipts");
    return false;
  }
}

/**
 * Fold retired "promo" assets into "catalog".
 *
 * The Promociones / Flyers section was removed — it duplicated the catalogue's purpose in
 * a section of its own. Without this the rows would still exist and simply stop being
 * shown anywhere, which loses a shop owner's files silently.
 *
 * Idempotent: once no promo rows remain it does nothing.
 */
export function migratePromoAssets(db: Database.Database): number {
  const { changes } = db
    .prepare(`UPDATE assets SET category = 'catalog' WHERE category = 'promo'`)
    .run();
  if (changes > 0) logger.info({ moved: changes }, "moved promo assets into the catalogue");
  return changes;
}
