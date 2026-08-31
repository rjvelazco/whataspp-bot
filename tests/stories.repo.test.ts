import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import type { Story } from "../src/domain/types.js";

// Same trick as seed.test.ts: point the DB at a throwaway file before anything reads
// config, and pull the repositories in with a dynamic import afterwards.
const dbPath = join(tmpdir(), `wabot-stories-test-${process.pid}.sqlite`);
for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
process.env.DB_PATH = dbPath;
process.env.STORE_ID = "novamoda";

type Repos = typeof import("../src/db/repositories.js");
let repos: Repos;
let db: import("better-sqlite3").Database;

function story(over: Partial<Story> = {}): Story {
  return {
    id: "st1",
    store_id: "novamoda",
    caption: "Vestidos nuevos",
    mode: "daily",
    weekdays: [],
    post_date: null,
    post_time: "09:00",
    delete_after: false,
    enabled: true,
    last_posted_at: null,
    created_at: "2026-08-24T12:00:00.000Z",
    media: [{ asset_id: "a1", position: 0 }],
    ...over,
  };
}

beforeAll(async () => {
  repos = await import("../src/db/repositories.js");
  db = (await import("../src/db/index.js")).db;
});

describe("story repositories", () => {
  it("round-trips every field, including the ones SQLite cannot hold natively", () => {
    repos.saveStory(
      story({
        id: "round",
        mode: "weekly",
        weekdays: [1, 3, 5],
        delete_after: true,
        enabled: false,
        last_posted_at: "2026-08-24T09:00:00.000Z",
      }),
    );

    const read = repos.getStory("round");
    // Weekdays live as a CSV string and the booleans as 0/1; the mapping is the part
    // that can silently return a truthy 0 or the string "1,3,5".
    expect(read?.weekdays).toEqual([1, 3, 5]);
    expect(read?.delete_after).toBe(true);
    expect(read?.enabled).toBe(false);
    expect(read?.mode).toBe("weekly");
    expect(read?.last_posted_at).toBe("2026-08-24T09:00:00.000Z");
  });

  it("keeps media in order and renumbers it on save", () => {
    repos.saveStory(
      story({
        id: "media",
        media: [
          { asset_id: "b", position: 7 },
          { asset_id: "a", position: 3 },
          { asset_id: "c", position: 99 },
        ],
      }),
    );

    // Position is the array order, not whatever the client sent — otherwise a reordered
    // strip saves gaps and the next edit sorts by a stale number.
    expect(repos.getStory("media")?.media).toEqual([
      { asset_id: "b", position: 0 },
      { asset_id: "a", position: 1 },
      { asset_id: "c", position: 2 },
    ]);
  });

  it("replaces the media on update rather than accumulating it", () => {
    repos.saveStory(story({ id: "edit", media: [{ asset_id: "x", position: 0 }] }));
    repos.saveStory(story({ id: "edit", media: [{ asset_id: "y", position: 0 }] }));

    expect(repos.getStory("edit")?.media).toEqual([{ asset_id: "y", position: 0 }]);
  });

  it("lists a store's stories with their media, and no one else's", () => {
    repos.saveStory(story({ id: "mine", store_id: "novamoda" }));
    repos.saveStory(story({ id: "theirs", store_id: "otra-tienda" }));

    const ids = repos.listStories("novamoda").map((s) => s.id);
    expect(ids).toContain("mine");
    expect(ids).not.toContain("theirs");
    expect(repos.listStories("novamoda").every((s) => s.media.length > 0)).toBe(true);
  });

  it("deletes the media with the story", () => {
    repos.saveStory(story({ id: "gone", media: [{ asset_id: "m", position: 0 }] }));
    repos.deleteStory("gone");

    expect(repos.getStory("gone")).toBeUndefined();
    // The cascade needs `foreign_keys = ON`; without it these rows outlive the story.
    const orphans = db
      .prepare(`SELECT COUNT(*) AS n FROM story_media WHERE story_id = ?`)
      .get("gone") as { n: number };
    expect(orphans.n).toBe(0);
  });

  it("assetInUse tells a shared media file from an orphaned one", () => {
    repos.saveStory(story({ id: "one", media: [{ asset_id: "shared", position: 0 }] }));
    repos.saveStory(story({ id: "two", media: [{ asset_id: "shared", position: 0 }] }));
    repos.saveStory(story({ id: "solo", media: [{ asset_id: "only-here", position: 0 }] }));

    // This is what stops a delete taking a file another story still points at.
    expect(repos.assetInUse("shared", "one")).toBe(true);
    expect(repos.assetInUse("only-here", "solo")).toBe(false);
    // Without an exception, any reference counts.
    expect(repos.assetInUse("only-here")).toBe(true);
    expect(repos.assetInUse("never-used")).toBe(false);
  });

  it("markStoryPosted writes the guard the scheduler reads", () => {
    repos.saveStory(story({ id: "stamp" }));
    expect(repos.getStory("stamp")?.last_posted_at).toBeNull();

    repos.markStoryPosted("stamp", "2026-08-24T09:00:30.000Z");
    expect(repos.getStory("stamp")?.last_posted_at).toBe("2026-08-24T09:00:30.000Z");
  });
});
