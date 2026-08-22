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

describe("migrateShowCategoryValue", () => {
  it("moves a legacy show_category target onto value, leaving other options alone", async () => {
    const { migrateShowCategoryValue } = await import("../src/services/seed.js");
    const input = [
      {
        key: "m",
        name: "m",
        message: "",
        options: [
          { label: "Vestidos", action: "show_category" as const, target: "Vestidos" },
          { label: "Ir", action: "go_menu" as const, target: "m2" },
          { label: "Ya migrado", action: "show_category" as const, value: "Tops" },
        ],
      },
    ];
    const { menus, changed } = migrateShowCategoryValue(input);
    expect(changed).toBe(true);
    expect(menus[0].options[0]).toEqual({ label: "Vestidos", action: "show_category", value: "Vestidos" });
    expect(menus[0].options[1]).toEqual({ label: "Ir", action: "go_menu", target: "m2" }); // untouched
    expect(menus[0].options[2]).toEqual({ label: "Ya migrado", action: "show_category", value: "Tops" });

    // Idempotent: a second pass changes nothing.
    expect(migrateShowCategoryValue(menus).changed).toBe(false);
  });
});
