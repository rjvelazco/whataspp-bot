import { describe, expect, it } from "vitest";
import { migrateLegacyStorySchedule } from "../src/db/migrateStories.js";
import type { Asset, Store, Story } from "../src/domain/types.js";

const store = (over: Partial<Store> = {}): Store => ({
  store_id: "novamoda",
  store_name: "Nova Moda",
  owner_name: "Ana",
  owner_whatsapp: "58414",
  hours: "",
  delivery_info: "",
  returns_policy: "",
  payments: {},
  size_guide: [],
  categories: [],
  ...over,
});

const asset = (id: string, created_at: string): Asset => ({
  id,
  store_id: "novamoda",
  category: "story",
  filename: `${id}.jpg`,
  original_name: `${id}.jpg`,
  mimetype: "image/jpeg",
  size: 100,
  created_at,
});

function harness(over: Partial<Parameters<typeof migrateLegacyStorySchedule>[0]> = {}) {
  const saved: Story[] = [];
  const marker = { ran: false };
  let counter = 0;
  const deps = {
    hasRun: () => marker.ran,
    markRun: () => {
      marker.ran = true;
    },
    getStore: () => store({ story_schedule: { enabled: true, time: "10:30" } }),
    listStoryAssets: () => [
      asset("b", "2026-08-02T00:00:00.000Z"),
      asset("a", "2026-08-01T00:00:00.000Z"),
    ],
    listStories: () => saved,
    saveStory: (s: Story) => saved.push(s),
    newId: () => `story-${++counter}`,
    now: () => new Date(2026, 7, 24, 12, 0),
    ...over,
  };
  return { deps, saved, marker };
}

describe("migrateLegacyStorySchedule", () => {
  it("folds every story asset into one daily story, oldest media first", () => {
    const h = harness();
    const created = migrateLegacyStorySchedule(h.deps);

    // One story, not one per asset: the owner thinks of it as "my daily batch", and
    // posting behaviour is identical either way — each image was always its own Status.
    expect(h.saved).toHaveLength(1);
    expect(created?.mode).toBe("daily");
    expect(created?.post_time).toBe("10:30");
    expect(created?.media).toEqual([
      { asset_id: "a", position: 0 },
      { asset_id: "b", position: 1 },
    ]);
  });

  it("inherits whether the old schedule was actually publishing", () => {
    const off = harness({
      getStore: () => store({ story_schedule: { enabled: false, time: "08:00" } }),
    });
    // A shop that never turned the old schedule on must not start broadcasting to its
    // customers because of a migration.
    expect(migrateLegacyStorySchedule(off.deps)?.enabled).toBe(false);
    expect(migrateLegacyStorySchedule(harness().deps)?.enabled).toBe(true);
  });

  it("still rescues the assets when no schedule was ever configured", () => {
    const h = harness({ getStore: () => store({ story_schedule: undefined }) });
    const created = migrateLegacyStorySchedule(h.deps);

    // Estados lists stories now, so an asset that belongs to no story is invisible.
    expect(created?.media).toHaveLength(2);
    expect(created?.enabled).toBe(false);
    expect(created?.post_time).toBe("09:00");
  });

  it("does nothing on a second boot", () => {
    const h = harness();
    expect(migrateLegacyStorySchedule(h.deps)).not.toBeNull();
    expect(migrateLegacyStorySchedule(h.deps)).toBeNull();
    expect(h.saved).toHaveLength(1);
  });

  it("stays done after the owner deletes every story", () => {
    const h = harness();
    migrateLegacyStorySchedule(h.deps);
    h.saved.length = 0; // the owner deleted their only story

    // Idempotence must not rest on the story count. It used to: with zero stories and
    // the legacy { enabled: true } still in the store row, the next orphaned upload was
    // folded into a live daily story and started broadcasting a file nobody scheduled.
    expect(migrateLegacyStorySchedule(h.deps)).toBeNull();
    expect(h.saved).toHaveLength(0);
  });

  it("marks itself done even when there was nothing to migrate", () => {
    const empty = harness({ listStoryAssets: () => [] });
    expect(migrateLegacyStorySchedule(empty.deps)).toBeNull();
    expect(empty.marker.ran).toBe(true);
  });

  it("does nothing when there is nothing to carry", () => {
    expect(migrateLegacyStorySchedule(harness({ listStoryAssets: () => [] }).deps)).toBeNull();
    expect(migrateLegacyStorySchedule(harness({ getStore: () => undefined }).deps)).toBeNull();
  });

  it("never sets delete_after, which would eat the media it reposts each day", () => {
    const created = migrateLegacyStorySchedule(harness().deps);
    expect(created?.delete_after).toBe(false);
    expect(created?.weekdays).toEqual([]);
    expect(created?.post_date).toBeNull();
    expect(created?.last_posted_at).toBeNull();
  });
});
