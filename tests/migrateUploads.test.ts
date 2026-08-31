import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migratePromoAssets, migrateUploadPaths } from "../src/db/migrateUploads.js";

/** Just enough schema to exercise the migration. */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE orders (order_id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
    CREATE TABLE catalog_items (item_id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
  `);
  return db;
}

const order = (id: string, receipt_url: string | null) =>
  JSON.stringify({ order_id: id, status: "delivered", receipt_url });
const item = (id: string, photo_url: string) => JSON.stringify({ item_id: id, photo_url });

const readOrder = (db: Database.Database, id: string) =>
  JSON.parse(
    (db.prepare(`SELECT data_json FROM orders WHERE order_id = ?`).get(id) as { data_json: string })
      .data_json,
  );
const readItem = (db: Database.Database, id: string) =>
  JSON.parse(
    (
      db.prepare(`SELECT data_json FROM catalog_items WHERE item_id = ?`).get(id) as {
        data_json: string;
      }
    ).data_json,
  );

describe("migrateUploadPaths", () => {
  let root: string;
  let dirs: { uploadsDir: string; receiptsDir: string };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "uploads-test-"));
    dirs = { uploadsDir: root, receiptsDir: join(root, "receipts") };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("rewrites the absolute paths that were live when the bug was found", () => {
    const db = makeDb();
    // Note the stale directory: the project had moved to .../projectos/whatsapp-bot.
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run(
      "1009",
      order("1009", "/Users/rjvelazco/Desktop/whatsapp-bot/uploads/receipt-1009.jpeg"),
    );
    writeFileSync(join(root, "receipt-1009.jpeg"), "jpeg-bytes");

    const result = migrateUploadPaths(db, dirs);

    expect(result).toEqual({ receipts: 1, photos: 0, moved: 1, failed: 0 });
    expect(readOrder(db, "1009").receipt_url).toBe("receipt-1009.jpeg");
    // The file moved into uploads/receipts/ and is still readable.
    expect(existsSync(join(dirs.receiptsDir, "receipt-1009.jpeg"))).toBe(true);
    expect(existsSync(join(root, "receipt-1009.jpeg"))).toBe(false);
  });

  it("is idempotent, so it can run on every boot", () => {
    const db = makeDb();
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run(
      "1",
      order("1", "/old/uploads/receipt-1.jpg"),
    );
    writeFileSync(join(root, "receipt-1.jpg"), "x");

    const first = migrateUploadPaths(db, dirs);
    const second = migrateUploadPaths(db, dirs);

    expect(first.receipts).toBe(1);
    expect(second).toEqual({ receipts: 0, photos: 0, moved: 0, failed: 0 });
    expect(readOrder(db, "1").receipt_url).toBe("receipt-1.jpg");
  });

  it("rewrites the row even when the file is gone", () => {
    // A bare name that 404s renders the designed placeholder; a stale absolute path
    // renders a broken image and leaks the old host layout through the API.
    const db = makeDb();
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("2", order("2", "/gone/receipt-2.jpg"));

    const result = migrateUploadPaths(db, dirs);

    expect(result).toEqual({ receipts: 1, photos: 0, moved: 0, failed: 0 });
    expect(readOrder(db, "2").receipt_url).toBe("receipt-2.jpg");
  });

  it("leaves orders without a receipt untouched", () => {
    const db = makeDb();
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("3", order("3", null));
    expect(migrateUploadPaths(db, dirs).receipts).toBe(0);
    expect(readOrder(db, "3").receipt_url).toBeNull();
  });

  it("basenames a local product photo but keeps a seeded remote URL", () => {
    const db = makeDb();
    db.prepare(`INSERT INTO catalog_items VALUES (?, ?)`).run(
      "local",
      item("local", "/Users/x/uploads/products/abc.jpg"),
    );
    db.prepare(`INSERT INTO catalog_items VALUES (?, ?)`).run(
      "remote",
      item("remote", "https://images.unsplash.com/photo-1?w=800&q=80"),
    );

    const result = migrateUploadPaths(db, dirs);

    expect(result.photos).toBe(1);
    expect(readItem(db, "local").photo_url).toBe("abc.jpg");
    // Served by redirect, so it must survive verbatim.
    expect(readItem(db, "remote").photo_url).toBe("https://images.unsplash.com/photo-1?w=800&q=80");
  });

  it("skips an unparseable row rather than throwing", () => {
    const db = makeDb();
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("bad", "{not json");
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("good", order("good", "/o/receipt-g.jpg"));

    expect(() => migrateUploadPaths(db, dirs)).not.toThrow();
    expect(readOrder(db, "good").receipt_url).toBe("receipt-g.jpg");
  });

  it("preserves every other field in data_json", () => {
    // The whole order lives in the blob, so a careless write would drop the items, the
    // total and the customer along with the path. This is the migration's real risk.
    const db = makeDb();
    const full = {
      order_id: "5",
      store_id: "novamoda",
      customer_wa: "584149682817@s.whatsapp.net",
      customer_name: "Adrian",
      items: [{ code: "TOPBASICO", size: "M", color: "blanco", qty: 2, price: 12 }],
      delivery_address: "C.C. Costa Verde",
      subtotal: 24,
      status: "delivered",
      receipt_url: "/old/uploads/receipt-5.jpg",
      created_at: "2026-07-10T17:06:46.228Z",
    };
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("5", JSON.stringify(full));
    writeFileSync(join(root, "receipt-5.jpg"), "x");

    migrateUploadPaths(db, dirs);

    expect(readOrder(db, "5")).toEqual({ ...full, receipt_url: "receipt-5.jpg" });
  });

  it("is idempotent for a Windows-shaped path too", () => {
    // POSIX basename does not split on a backslash, so without normalising separators
    // first this row was "migrated" identically on every single boot, forever.
    const db = makeDb();
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run(
      "6",
      order("6", "C:\\uploads\\receipt-6.jpg"),
    );

    const first = migrateUploadPaths(db, dirs);
    const second = migrateUploadPaths(db, dirs);

    expect(first.receipts).toBe(1);
    expect(readOrder(db, "6").receipt_url).toBe("receipt-6.jpg");
    expect(second.receipts).toBe(0);
  });

  it("relocates from the directory the row recorded, not just the current one", () => {
    // The case this migration exists for: UPLOADS_DIR itself moved. The file is only at
    // the path in the row, so looking exclusively in the new root would orphan it.
    const db = makeDb();
    const elsewhere = mkdtempSync(join(tmpdir(), "old-uploads-"));
    const stored = join(elsewhere, "receipt-7.jpg");
    writeFileSync(stored, "bytes");
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("7", order("7", stored));

    const result = migrateUploadPaths(db, dirs);

    expect(result.moved).toBe(1);
    expect(existsSync(join(dirs.receiptsDir, "receipt-7.jpg"))).toBe(true);
    expect(readOrder(db, "7").receipt_url).toBe("receipt-7.jpg");
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("survives a filesystem error instead of taking the boot down", () => {
    // A directory where the file should go makes renameSync throw. Before, that
    // propagated out of a module-load side effect and the process never started — and it
    // failed the same way on every retry.
    const db = makeDb();
    writeFileSync(join(root, "receipt-8.jpg"), "x");
    mkdirSync(join(dirs.receiptsDir, "receipt-8.jpg"), { recursive: true });
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("8", order("8", "/old/receipt-8.jpg"));

    expect(() => migrateUploadPaths(db, dirs)).not.toThrow();
    // The row is still normalised, so the API stops leaking the old absolute path.
    expect(readOrder(db, "8").receipt_url).toBe("receipt-8.jpg");
  });

  it("does not clobber a file already in the receipts directory", () => {
    const db = makeDb();
    mkdirSync(dirs.receiptsDir, { recursive: true });
    writeFileSync(join(dirs.receiptsDir, "receipt-4.jpg"), "already-here");
    writeFileSync(join(root, "receipt-4.jpg"), "legacy-duplicate");
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("4", order("4", "/old/receipt-4.jpg"));

    const result = migrateUploadPaths(db, dirs);

    expect(result.moved).toBe(0);
    expect(readOrder(db, "4").receipt_url).toBe("receipt-4.jpg");
  });
});

describe("migratePromoAssets", () => {
  /** Just the columns the migration touches. */
  function assetsDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, category TEXT NOT NULL)`);
    return db;
  }

  const categories = (db: Database.Database) =>
    (
      db.prepare(`SELECT id, category FROM assets ORDER BY id`).all() as {
        id: string;
        category: string;
      }[]
    ).map((r) => `${r.id}:${r.category}`);

  it("folds promo rows into the catalogue and leaves the rest alone", () => {
    const db = assetsDb();
    const insert = db.prepare(`INSERT INTO assets (id, category) VALUES (?, ?)`);
    insert.run("a", "promo");
    insert.run("b", "catalog");
    insert.run("c", "story");
    insert.run("d", "promo");

    expect(migratePromoAssets(db)).toBe(2);
    // The section was deleted, so without this a shop owner's files stop being shown
    // anywhere while the rows quietly remain.
    expect(categories(db)).toEqual(["a:catalog", "b:catalog", "c:story", "d:catalog"]);
  });

  it("is idempotent — a second boot changes nothing", () => {
    const db = assetsDb();
    db.prepare(`INSERT INTO assets (id, category) VALUES (?, ?)`).run("a", "promo");

    expect(migratePromoAssets(db)).toBe(1);
    expect(migratePromoAssets(db)).toBe(0);
    expect(categories(db)).toEqual(["a:catalog"]);
  });
});
