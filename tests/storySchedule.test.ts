import { describe, expect, it } from "vitest";
import {
  POST_WINDOW_MS,
  isStoryDue,
  isoWeekday,
  localDateKey,
  parseTimeMinutes,
  postedToday,
  runsOnDate,
} from "../src/domain/storySchedule.js";
import type { Story, StoryMode } from "../src/domain/types.js";

/** A story that is due at 09:00, with everything else out of the way. */
function story(over: Partial<Story> = {}): Story {
  return {
    id: "st1",
    store_id: "novamoda",
    caption: "",
    mode: "daily" as StoryMode,
    weekdays: [],
    post_date: null,
    post_time: "09:00",
    delete_after: false,
    enabled: true,
    last_posted_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    media: [{ asset_id: "a1", position: 0 }],
    ...over,
  };
}

/** A local-time Date, so the tests read as the shop owner's clock. */
const at = (y: number, m: number, d: number, hh: number, mm: number, ss = 0) =>
  new Date(y, m - 1, d, hh, mm, ss);

describe("parseTimeMinutes", () => {
  it("reads a 24h clock", () => {
    expect(parseTimeMinutes("09:00")).toBe(540);
    expect(parseTimeMinutes("9:05")).toBe(545);
    expect(parseTimeMinutes("00:00")).toBe(0);
    expect(parseTimeMinutes("23:59")).toBe(1439);
  });

  it("rejects anything that is not one", () => {
    for (const bad of ["", "9", "24:00", "12:60", "09:00:00", "nueve", "9:5", "-1:00"]) {
      expect(parseTimeMinutes(bad)).toBeNull();
    }
  });
});

describe("isoWeekday", () => {
  it("counts from Monday, not from Sunday", () => {
    // 2026-08-24 is a Monday.
    expect(isoWeekday(at(2026, 8, 24, 12, 0))).toBe(1);
    expect(isoWeekday(at(2026, 8, 29, 12, 0))).toBe(6);
    expect(isoWeekday(at(2026, 8, 30, 12, 0))).toBe(7); // Sunday, where JS says 0
  });
});

describe("localDateKey", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(localDateKey(at(2026, 8, 24, 0, 30))).toBe("2026-08-24");
    expect(localDateKey(at(2026, 8, 24, 23, 30))).toBe("2026-08-24");
    expect(localDateKey(at(2026, 1, 5, 12, 0))).toBe("2026-01-05");
  });
});

describe("runsOnDate", () => {
  it("daily runs every day", () => {
    expect(runsOnDate(story(), at(2026, 8, 24, 9, 0))).toBe(true);
    expect(runsOnDate(story(), at(2026, 8, 30, 9, 0))).toBe(true);
  });

  it("weekly runs only on its weekdays", () => {
    const s = story({ mode: "weekly", weekdays: [1, 3, 5] }); // Mon, Wed, Fri
    expect(runsOnDate(s, at(2026, 8, 24, 9, 0))).toBe(true); // Monday
    expect(runsOnDate(s, at(2026, 8, 25, 9, 0))).toBe(false); // Tuesday
    expect(runsOnDate(s, at(2026, 8, 26, 9, 0))).toBe(true); // Wednesday
    expect(runsOnDate(s, at(2026, 8, 30, 9, 0))).toBe(false); // Sunday
  });

  it("weekly with no weekdays selected never runs", () => {
    expect(runsOnDate(story({ mode: "weekly", weekdays: [] }), at(2026, 8, 24, 9, 0))).toBe(false);
  });

  it("once runs only on its date", () => {
    const s = story({ mode: "once", post_date: "2026-08-24" });
    expect(runsOnDate(s, at(2026, 8, 24, 9, 0))).toBe(true);
    expect(runsOnDate(s, at(2026, 8, 25, 9, 0))).toBe(false);
    expect(runsOnDate(story({ mode: "once", post_date: null }), at(2026, 8, 24, 9, 0))).toBe(false);
  });
});

describe("postedToday", () => {
  it("compares local dates, so 23:50 and 00:10 are different days", () => {
    const s = story({ last_posted_at: at(2026, 8, 24, 23, 50).toISOString() });
    expect(postedToday(s, at(2026, 8, 24, 23, 55))).toBe(true);
    expect(postedToday(s, at(2026, 8, 25, 0, 10))).toBe(false);
  });

  it("treats a never-posted or unparseable stamp as not posted", () => {
    expect(postedToday(story(), at(2026, 8, 24, 9, 0))).toBe(false);
    expect(postedToday(story({ last_posted_at: "no" }), at(2026, 8, 24, 9, 0))).toBe(false);
  });
});

describe("isStoryDue", () => {
  it("fires at the scheduled minute", () => {
    expect(isStoryDue(story(), at(2026, 8, 24, 9, 0))).toBe(true);
  });

  it("fires inside the window and not after it", () => {
    expect(isStoryDue(story(), at(2026, 8, 24, 9, 1, 59))).toBe(true);
    const past = new Date(at(2026, 8, 24, 9, 0).getTime() + POST_WINDOW_MS);
    expect(isStoryDue(story(), past)).toBe(false);
  });

  it("does not fire early", () => {
    expect(isStoryDue(story(), at(2026, 8, 24, 8, 59, 59))).toBe(false);
  });

  it("does not fire later the same day — this is the restart bug", () => {
    // The old guard lived in memory, so a bot restarted at 09:01 re-posted the Status
    // that had already gone out to every customer at 09:00.
    const posted = story({ last_posted_at: at(2026, 8, 24, 9, 0).toISOString() });
    expect(isStoryDue(posted, at(2026, 8, 24, 9, 1))).toBe(false);
  });

  it("fires again the next day", () => {
    const posted = story({ last_posted_at: at(2026, 8, 24, 9, 0).toISOString() });
    expect(isStoryDue(posted, at(2026, 8, 25, 9, 0))).toBe(true);
  });

  it("a once story never fires twice, even a year later on the same date", () => {
    const s = story({
      mode: "once",
      post_date: "2026-08-24",
      last_posted_at: at(2026, 8, 24, 9, 0).toISOString(),
    });
    expect(isStoryDue(s, at(2026, 8, 24, 9, 0))).toBe(false);
    expect(isStoryDue({ ...s, post_date: "2027-08-24" }, at(2027, 8, 24, 9, 0))).toBe(false);
  });

  it("skips a story that is paused, empty, or has a malformed time", () => {
    expect(isStoryDue(story({ enabled: false }), at(2026, 8, 24, 9, 0))).toBe(false);
    expect(isStoryDue(story({ media: [] }), at(2026, 8, 24, 9, 0))).toBe(false);
    expect(isStoryDue(story({ post_time: "9am" }), at(2026, 8, 24, 9, 0))).toBe(false);
  });

  it("respects the weekday selection at the right minute", () => {
    const s = story({ mode: "weekly", weekdays: [2, 4] }); // Tue, Thu
    expect(isStoryDue(s, at(2026, 8, 24, 9, 0))).toBe(false); // Monday
    expect(isStoryDue(s, at(2026, 8, 25, 9, 0))).toBe(true); // Tuesday
  });

  it("handles midnight", () => {
    const s = story({ post_time: "00:00" });
    expect(isStoryDue(s, at(2026, 8, 24, 0, 0))).toBe(true);
    expect(isStoryDue(s, at(2026, 8, 23, 23, 59))).toBe(false);
  });
});
