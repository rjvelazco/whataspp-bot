import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { isLegacyPath, toStoredFilename } from "../domain/uploads.js";

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
 * Idempotent: a row that already holds a bare filename is left alone, so this is safe to
 * run on every boot. It touches both the column and the JSON blob where a field is
 * duplicated across the two.
 */
export function migrateUploadPaths(
  db: Database.Database,
  dirs: { uploadsDir: string; receiptsDir: string },
): { receipts: number; photos: number; moved: number } {
  let receipts = 0;
  let photos = 0;
  let moved = 0;

  // ---- orders.receipt_url ----
  const orders = db.prepare(`SELECT order_id, data_json FROM orders`).all() as {
    order_id: string;
    data_json: string;
  }[];
  const updateOrder = db.prepare(`UPDATE orders SET data_json = ? WHERE order_id = ?`);

  for (const row of orders) {
    let order: { receipt_url?: string | null };
    try {
      order = JSON.parse(row.data_json);
    } catch {
      continue; // unparseable row; leave it for a human
    }
    if (!isLegacyPath(order.receipt_url)) continue;
    const filename = toStoredFilename(order.receipt_url);
    if (!filename) continue;

    // Relocate the file if it is still where the old layout put it.
    const target = join(dirs.receiptsDir, filename);
    if (!existsSync(target)) {
      const legacy = join(dirs.uploadsDir, filename);
      if (existsSync(legacy)) {
        mkdirSync(dirs.receiptsDir, { recursive: true });
        renameSync(legacy, target);
        moved += 1;
      }
    }

    // Rewrite the row even when the file is missing: a bare name that 404s renders the
    // designed "sin comprobante" placeholder, where a stale absolute path renders a
    // broken image and leaks the old host layout through the API.
    updateOrder.run(JSON.stringify({ ...order, receipt_url: filename }), row.order_id);
    receipts += 1;
  }

  // ---- catalog_items.photo_url ----
  const items = db.prepare(`SELECT item_id, data_json FROM catalog_items`).all() as {
    item_id: string;
    data_json: string;
  }[];
  const updateItem = db.prepare(`UPDATE catalog_items SET data_json = ? WHERE item_id = ?`);

  for (const row of items) {
    let item: { photo_url?: string | null };
    try {
      item = JSON.parse(row.data_json);
    } catch {
      continue;
    }
    // Seeded products carry remote URLs, which are served by redirect and must stay.
    const photo = item.photo_url;
    if (!photo || /^https?:\/\//.test(photo)) continue;
    if (!isLegacyPath(photo)) continue;
    const filename = toStoredFilename(photo);
    if (!filename) continue;
    updateItem.run(JSON.stringify({ ...item, photo_url: filename }), row.item_id);
    photos += 1;
  }

  return { receipts, photos, moved };
}
