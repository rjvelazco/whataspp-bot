import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateUploadPaths } from "../src/db/migrateUploads.js";

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

    expect(result).toEqual({ receipts: 1, photos: 0, moved: 1 });
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
    expect(second).toEqual({ receipts: 0, photos: 0, moved: 0 });
    expect(readOrder(db, "1").receipt_url).toBe("receipt-1.jpg");
  });

  it("rewrites the row even when the file is gone", () => {
    // A bare name that 404s renders the designed placeholder; a stale absolute path
    // renders a broken image and leaks the old host layout through the API.
    const db = makeDb();
    db.prepare(`INSERT INTO orders VALUES (?, ?)`).run("2", order("2", "/gone/receipt-2.jpg"));

    const result = migrateUploadPaths(db, dirs);

    expect(result).toEqual({ receipts: 1, photos: 0, moved: 0 });
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
