import type { Story } from "./types.js";

/**
 * When a scheduled Status is due.
 *
 * Pure, and deliberately separate from the scheduler that drives it: this is the part
 * with all the edge cases (weekday arithmetic, the once-only guard, the restart that
 * used to double-post), and it should be testable without a database, a clock, or a
 * WhatsApp connection.
 */

/**
 * How long after its scheduled minute a story may still go out.
 *
 * Without a window, a story set for 09:00 that had not posted yet would fire the moment
 * the bot came up at 23:00 — a Status to every customer, at the wrong time of day. The
 * cost is the other direction: a bot that is down for this whole window misses the day
 * rather than posting late. For something that broadcasts to customers, missing is the
 * better failure.
 */
export const POST_WINDOW_MS = 2 * 60_000;

/** "09:00" -> 540 minutes past midnight; null if malformed. */
export function parseTimeMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. JS counts from Sunday, which nobody expects. */
export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** Local calendar date as "YYYY-MM-DD". Local, not UTC: the owner schedules in their day. */
export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whether the story has already gone out on `now`'s local date. */
export function postedToday(story: Story, now: Date): boolean {
  if (!story.last_posted_at) return false;
  const last = new Date(story.last_posted_at);
  if (Number.isNaN(last.getTime())) return false;
  return localDateKey(last) === localDateKey(now);
}

/** Whether the calendar says this story runs on `now`'s date at all. */
export function runsOnDate(story: Story, now: Date): boolean {
  switch (story.mode) {
    case "daily":
      return true;
    case "weekly":
      return story.weekdays.includes(isoWeekday(now));
    case "once":
      return story.post_date === localDateKey(now);
  }
}

/**
 * Whether this story should post right now.
 *
 * The guard is `last_posted_at`, read from the database rather than held in memory, so
 * restarting the bot at 09:01 no longer re-posts the 09:00 Status.
 */
export function isStoryDue(story: Story, now: Date): boolean {
  if (!story.enabled) return false;
  if (story.media.length === 0) return false;

  const scheduledMinutes = parseTimeMinutes(story.post_time);
  if (scheduledMinutes === null) return false;
  if (!runsOnDate(story, now)) return false;

  // A one-time story posts once, full stop — not again next year on the same date.
  if (story.mode === "once" && story.last_posted_at) return false;
  if (postedToday(story, now)) return false;

  // Built with setHours rather than midnight-plus-minutes: on a DST changeover the two
  // disagree by an hour, and setHours is the one that means "09:00 where the shop is".
  const scheduled = new Date(now);
  scheduled.setHours(Math.floor(scheduledMinutes / 60), scheduledMinutes % 60, 0, 0);
  const nowMs = now.getTime();
  return nowMs >= scheduled.getTime() && nowMs < scheduled.getTime() + POST_WINDOW_MS;
}
