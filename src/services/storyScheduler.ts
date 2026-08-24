import { logger } from "../logger.js";
import { isStoryDue } from "../domain/storySchedule.js";
import type { StoryMediaFile } from "./stories.js";
import type { Story } from "../domain/types.js";

/** Result of a posting run, surfaced to the "Publicar ahora" button. */
export type StoryPostReason = "ok" | "disconnected" | "no_media" | "busy" | "not_found";

export interface StoryPostResult {
  posted: number;
  audience: number;
  reason: StoryPostReason;
}

export interface StorySchedulerDeps {
  /** Read the stories fresh each tick, so admin edits take effect without a restart. */
  listStories: () => Story[];
  getStory: (id: string) => Story | undefined;
  /** Jids allowed to see the Status (privacy list). */
  listAudience: () => string[];
  /** Post one image to Status. */
  postImage: (path: string, audience: string[], caption?: string) => Promise<void>;
  /** Post one video to Status. */
  postVideo: (path: string, audience: string[], caption?: string) => Promise<void>;
  /**
   * The story's media, resolved to files on disk.
   *
   * Injected rather than imported so that the scheduler — the piece with the retry,
   * dispatch and bookkeeping logic — can be tested without a database or a filesystem.
   */
  resolveMedia: (story: Story) => StoryMediaFile[];
  /** Whether WhatsApp is currently linked (posting while offline would hang). */
  isConnected: () => boolean;
  /** Persist the once-per-day guard. */
  markPosted: (storyId: string, at: string) => void;
  /** Drop a one-time story that asked to clean up after itself. */
  discardStory: (story: Story) => void;
  /** Injectable clock, so the tests do not have to wait for a real minute to arrive. */
  now?: () => Date;
}

const TICK_MS = 30_000;

/**
 * Publishes scheduled stories to WhatsApp Status.
 *
 * The scheduling decision itself lives in domain/storySchedule.ts; this class is the
 * loop, the transport dispatch and the bookkeeping around it.
 */
export class StoryScheduler {
  private timer?: ReturnType<typeof setInterval>;
  /** Stories currently publishing, so a tick and a button press cannot overlap. */
  private readonly publishing = new Set<string>();

  constructor(private readonly deps: StorySchedulerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

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

  /** Publish every story that is due right now. Exposed for tests. */
  tick(): void {
    const now = this.now();
    for (const story of this.deps.listStories()) {
      if (isStoryDue(story, now)) void this.publish(story, "scheduled");
    }
  }

  /**
   * Manual publish from the admin panel.
   *
   * This counts as today's publication: it stamps the guard, so a story published by
   * hand at 08:00 does not go out again at 09:00. Posting the same Status to every
   * customer twice is a worse outcome than skipping one scheduled run, and the UI says
   * so before the owner confirms.
   */
  async postNow(storyId: string): Promise<StoryPostResult> {
    const story = this.deps.getStory(storyId);
    if (!story) return { posted: 0, audience: 0, reason: "not_found" };
    return this.publish(story, "manual");
  }

  private async publish(story: Story, reason: "scheduled" | "manual"): Promise<StoryPostResult> {
    if (this.publishing.has(story.id)) return { posted: 0, audience: 0, reason: "busy" };
    this.publishing.add(story.id);
    try {
      if (!this.deps.isConnected()) {
        logger.warn({ reason, story: story.id }, "story post skipped — WhatsApp not connected");
        return { posted: 0, audience: 0, reason: "disconnected" };
      }

      const media = this.deps.resolveMedia(story);
      const audience = this.deps.listAudience();
      if (media.length === 0) {
        logger.info({ reason, story: story.id }, "story post skipped — no usable media");
        return { posted: 0, audience: audience.length, reason: "no_media" };
      }

      let posted = 0;
      for (const { asset, path } of media) {
        try {
          // Each media file is its own Status, so each carries the caption — a
          // follow-up frame with no text reads as a mistake to the customer.
          const caption = story.caption || undefined;
          if (asset.mimetype.startsWith("video/")) {
            await this.deps.postVideo(path, audience, caption);
          } else {
            await this.deps.postImage(path, audience, caption);
          }
          posted += 1;
        } catch (err) {
          logger.error({ err, story: story.id, asset: asset.id }, "failed to post a Status");
        }
      }

      if (posted > 0) {
        this.deps.markPosted(story.id, this.now().toISOString());
        // Only a one-time story may clean up after itself; on a repeating one this
        // would delete the media it needs for the next run.
        if (story.mode === "once" && story.delete_after) this.deps.discardStory(story);
      }

      logger.info(
        { reason, story: story.id, posted, audience: audience.length },
        "story posted to Status",
      );
      return { posted, audience: audience.length, reason: "ok" };
    } finally {
      this.publishing.delete(story.id);
    }
  }
}
