import { join } from "node:path";
import { logger } from "../logger.js";
import type { Asset, Store } from "../domain/types.js";

/** Result of a posting run, surfaced to the "Publicar ahora" button. */
export interface StoryPostResult {
  posted: number;
  audience: number;
  reason: "ok" | "disconnected" | "no_stories" | "busy";
}

export interface StorySchedulerDeps {
  /** Read the store fresh each tick, so admin edits take effect without a restart. */
  getStore: () => Store | undefined;
  /** Current "story" assets to publish. */
  listStories: () => Asset[];
  /** Jids allowed to see the Status (privacy list). */
  listAudience: () => string[];
  /** Post one image to Status. */
  postImage: (path: string, audience: string[], caption?: string) => Promise<void>;
  /** Whether WhatsApp is currently linked (posting while offline would hang). */
  isConnected: () => boolean;
  uploadsDir: string;
}

const TICK_MS = 30_000;
/** Fire within this window after the scheduled minute, so a brief drift/gap won't skip a day. */
const WINDOW_MS = 2 * 60_000;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "09:00" → 540 minutes; null if malformed. */
function parseMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Posts the store's "story" assets to WhatsApp Status once per day at the
 * configured local time. Uses server local time; posts "at or just after" the
 * scheduled minute (within a short window) so a restart near that time still fires.
 */
export class StoryScheduler {
  private timer?: ReturnType<typeof setInterval>;
  /** Day (dateKey) we last auto-posted, so we fire at most once per day. */
  private lastRun = "";
  private running = false;

  constructor(private readonly deps: StorySchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    logger.info("story scheduler started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const schedule = this.deps.getStore()?.story_schedule;
    if (!schedule?.enabled) return;
    const scheduledMin = parseMinutes(schedule.time);
    if (scheduledMin === null) return;

    const now = new Date();
    const today = dateKey(now);
    if (this.lastRun === today) return; // already posted today

    const nowMs = now.getTime();
    const scheduledMs = new Date(now).setHours(0, 0, 0, 0) + scheduledMin * 60_000;
    if (nowMs < scheduledMs || nowMs >= scheduledMs + WINDOW_MS) return;

    this.lastRun = today;
    void this.postAll("scheduled");
  }

  /** Manual trigger from the admin panel; does not affect the daily guard. */
  async postNow(): Promise<StoryPostResult> {
    return this.postAll("manual");
  }

  private async postAll(reason: "scheduled" | "manual"): Promise<StoryPostResult> {
    if (this.running) return { posted: 0, audience: 0, reason: "busy" };
    this.running = true;
    try {
      if (!this.deps.isConnected()) {
        logger.warn({ reason }, "story post skipped — WhatsApp not connected");
        return { posted: 0, audience: 0, reason: "disconnected" };
      }
      const stories = this.deps.listStories().filter((a) => a.mimetype.startsWith("image/"));
      const audience = this.deps.listAudience();
      if (stories.length === 0) {
        logger.info({ reason }, "story post skipped — no story images");
        return { posted: 0, audience: audience.length, reason: "no_stories" };
      }

      let posted = 0;
      for (const asset of stories) {
        const path = join(this.deps.uploadsDir, "assets", asset.filename);
        try {
          await this.deps.postImage(path, audience);
          posted += 1;
        } catch (err) {
          logger.error({ err, asset: asset.id }, "failed to post a story to Status");
        }
      }
      logger.info({ reason, posted, audience: audience.length }, "stories posted to Status");
      return { posted, audience: audience.length, reason: "ok" };
    } finally {
      this.running = false;
    }
  }
}
