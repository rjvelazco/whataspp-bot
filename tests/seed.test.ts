import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

// Point the DB at a throwaway file BEFORE importing anything that reads config.
// Static imports are hoisted, so seed/repositories are pulled in via dynamic import
// below — after the env var is set — so they open this temp DB, not the real one.
const dbPath = join(tmpdir(), `wabot-seed-test-${process.pid}.sqlite`);
for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
process.env.DB_PATH = dbPath;
process.env.STORE_ID = "novamoda";

describe("catalog seed is idempotent (DB is authoritative after first boot)", () => {
  it("seeds once, then preserves owner edits across a reseed and never duplicates rows", async () => {
    const { seedStore } = await import("../src/services/seed.js");
    const { getAllItems, getItemById, updateItem } = await import("../src/db/repositories.js");

    // First boot: catalog imported from JSON.
    seedStore("novamoda");
    const seeded = getAllItems("novamoda");
    expect(seeded.length).toBeGreaterThan(0);

    // Owner edits a product (as the Productos admin would).
    const edited = { ...seeded[0], price: 999.99 };
    updateItem(edited);

    // Restart → reseed. The guard must keep the DB copy, not re-import the JSON.
    seedStore("novamoda");

    const after = getItemById("novamoda", edited.item_id);
    expect(after?.price).toBe(999.99); // edit survived the reseed
    expect(getAllItems("novamoda").length).toBe(seeded.length); // no duplicate rows
  });
});
