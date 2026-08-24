import { describe, expect, it, vi } from "vitest";
import { StoryScheduler, type StorySchedulerDeps } from "../src/services/storyScheduler.js";
import type { Asset, Story } from "../src/domain/types.js";

/**
 * The scheduler with every edge injected, so these tests exercise dispatch and
 * bookkeeping without a database, a filesystem or a WhatsApp connection.
 */

const asset = (id: string, mimetype: string): Asset => ({
  id,
  store_id: "novamoda",
  category: "story",
  filename: `${id}.bin`,
  original_name: `${id}.jpg`,
  mimetype,
  size: 1000,
  created_at: "2026-08-01T00:00:00.000Z",
});

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
    created_at: "2026-08-01T00:00:00.000Z",
    media: [{ asset_id: "a1", position: 0 }],
    ...over,
  };
}

const at = (hh: number, mm: number) => new Date(2026, 7, 24, hh, mm, 0); // Mon 2026-08-24

interface Harness {
  scheduler: StoryScheduler;
  deps: StorySchedulerDeps;
  stories: Story[];
  images: string[];
  videos: string[];
  captions: (string | undefined)[];
}

function harness(over: Partial<StorySchedulerDeps> = {}, initial: Story[] = [story()]): Harness {
  const stories = [...initial];
  const images: string[] = [];
  const videos: string[] = [];
  const captions: (string | undefined)[] = [];
  const media: Record<string, Asset> = {
    a1: asset("a1", "image/jpeg"),
    a2: asset("a2", "image/jpeg"),
    v1: asset("v1", "video/mp4"),
  };

  const deps: StorySchedulerDeps = {
    listStories: () => stories,
    getStory: (id) => stories.find((s) => s.id === id),
    listAudience: () => ["58414@s.whatsapp.net", "58424@s.whatsapp.net"],
    resolveMedia: (s) =>
      s.media
        .map((m) => media[m.asset_id])
        .filter(Boolean)
        .map((a) => ({ asset: a, path: `/uploads/assets/${a.filename}` })),
    postImage: async (path, _audience, caption) => {
      images.push(path);
      captions.push(caption);
    },
    postVideo: async (path, _audience, caption) => {
      videos.push(path);
      captions.push(caption);
    },
    isConnected: () => true,
    markPosted: (id, atIso) => {
      const found = stories.find((s) => s.id === id);
      if (found) found.last_posted_at = atIso;
    },
    discardStory: vi.fn(),
    now: () => at(9, 0),
    ...over,
  };
  return { scheduler: new StoryScheduler(deps), deps, stories, images, videos, captions };
}

describe("StoryScheduler.tick", () => {
  it("publishes a story that is due", async () => {
    const h = harness();
    h.scheduler.tick();
    await vi.waitFor(() => expect(h.images).toHaveLength(1));
    expect(h.images[0]).toBe("/uploads/assets/a1.bin");
  });

  it("does not publish one that is not", async () => {
    const h = harness({ now: () => at(8, 0) });
    h.scheduler.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.images).toHaveLength(0);
  });

  it("stamps the guard, so the next tick that minute does nothing", async () => {
    const h = harness();
    h.scheduler.tick();
    await vi.waitFor(() => expect(h.images).toHaveLength(1));
    // This is the restart bug: the old guard was in memory, so coming back up inside
    // the window re-posted the same Status to every customer.
    expect(h.stories[0].last_posted_at).toBe(at(9, 0).toISOString());

    h.scheduler.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.images).toHaveLength(1);
  });

  it("publishes each story independently", async () => {
    const h = harness({}, [
      story({ id: "a" }),
      story({ id: "b", post_time: "18:00" }),
      story({ id: "c", enabled: false }),
    ]);
    h.scheduler.tick();
    await vi.waitFor(() => expect(h.images).toHaveLength(1));
    expect(h.stories.find((s) => s.id === "a")?.last_posted_at).not.toBeNull();
    expect(h.stories.find((s) => s.id === "b")?.last_posted_at).toBeNull();
    expect(h.stories.find((s) => s.id === "c")?.last_posted_at).toBeNull();
  });
});

describe("StoryScheduler.postNow", () => {
  it("dispatches video and image to different transport calls", async () => {
    const h = harness({}, [story({ media: [{ asset_id: "v1", position: 0 }] })]);
    const result = await h.scheduler.postNow("st1");

    expect(result).toEqual({ posted: 1, audience: 2, reason: "ok" });
    expect(h.videos).toEqual(["/uploads/assets/v1.bin"]);
    expect(h.images).toEqual([]);
  });

  it("carries the caption on every frame", async () => {
    const h = harness({}, [
      story({
        media: [
          { asset_id: "a1", position: 0 },
          { asset_id: "v1", position: 1 },
        ],
      }),
    ]);
    await h.scheduler.postNow("st1");
    // Each media file is its own Status; a follow-up frame with no text reads as a
    // mistake to the customer.
    expect(h.captions).toEqual(["Vestidos nuevos", "Vestidos nuevos"]);
  });

  it("sends no caption at all when there is none", async () => {
    const h = harness({}, [story({ caption: "" })]);
    await h.scheduler.postNow("st1");
    expect(h.captions).toEqual([undefined]);
  });

  it("refuses when WhatsApp is not linked", async () => {
    const h = harness({ isConnected: () => false });
    expect(await h.scheduler.postNow("st1")).toEqual({
      posted: 0,
      audience: 0,
      reason: "disconnected",
    });
    expect(h.stories[0].last_posted_at).toBeNull();
  });

  it("reports a story whose media have all gone", async () => {
    const h = harness({ resolveMedia: () => [] });
    expect(await h.scheduler.postNow("st1")).toMatchObject({ posted: 0, reason: "no_media" });
    // Nothing went out, so nothing may be recorded as having gone out.
    expect(h.stories[0].last_posted_at).toBeNull();
  });

  it("reports an unknown story", async () => {
    const h = harness();
    expect(await h.scheduler.postNow("nope")).toEqual({
      posted: 0,
      audience: 0,
      reason: "not_found",
    });
  });

  it("keeps going when one frame fails, and still records the ones that went", async () => {
    let call = 0;
    const h = harness(
      {
        postImage: async () => {
          call += 1;
          if (call === 1) throw new Error("network");
        },
      },
      [
        story({
          media: [
            { asset_id: "a1", position: 0 },
            { asset_id: "a1x", position: 1 },
          ],
        }),
      ],
    );
    const result = await h.scheduler.postNow("st1");
    expect(result.posted).toBe(0); // a1x resolves to nothing, a1 threw
    expect(h.stories[0].last_posted_at).toBeNull();
  });

  it("stamps the guard before the first frame goes out, not after the last", async () => {
    const order: string[] = [];
    const h = harness(
      {
        markPosted: (id, at) => {
          order.push(at ? "stamp" : "restore");
          void id;
          void at;
        },
        postImage: async () => {
          order.push("post");
        },
      },
      [
        story({
          media: [
            { asset_id: "a1", position: 0 },
            { asset_id: "a1", position: 1 },
          ],
        }),
      ],
    );
    await h.scheduler.postNow("st1");

    // A frame can be a 32MB upload, so the loop takes a real share of the 120s window.
    // If the process dies partway through, the guard has to already be written or a
    // restart re-broadcasts every frame that had gone out.
    expect(order).toEqual(["stamp", "post", "post"]);
  });

  it("restores the guard when every frame failed", async () => {
    const h = harness(
      {
        postImage: async () => {
          throw new Error("network");
        },
      },
      [story({ last_posted_at: null })],
    );
    await h.scheduler.postNow("st1");
    expect(h.stories[0].last_posted_at).toBeNull();
  });

  it("keeps yesterday's stamp when today's run failed entirely", async () => {
    const yesterday = new Date(2026, 7, 23, 9, 0).toISOString();
    const h = harness(
      {
        postImage: async () => {
          throw new Error("network");
        },
      },
      [story({ last_posted_at: yesterday })],
    );
    await h.scheduler.postNow("st1");
    // Restored to what it was, not blanked.
    expect(h.stories[0].last_posted_at).toBe(yesterday);
  });

  it("never deletes media when only some frames published", async () => {
    let call = 0;
    const h = harness(
      {
        postImage: async () => {
          call += 1;
          if (call === 2) throw new Error("network");
        },
      },
      [
        story({
          mode: "once",
          post_date: "2026-08-24",
          delete_after: true,
          media: [
            { asset_id: "a1", position: 0 },
            { asset_id: "a2", position: 1 },
          ],
        }),
      ],
    );
    const result = await h.scheduler.postNow("st1");

    // One of the two frames went out; the other threw.
    expect(result.posted).toBe(1);
    // discardStory erases the files. On a partial run that would destroy the originals
    // of frames the customer never received.
    expect(h.deps.discardStory).not.toHaveBeenCalled();
  });

  it("deletes a one-time story that asked to clean up, and only that kind", async () => {
    const once = harness({}, [
      story({ mode: "once", post_date: "2026-08-24", delete_after: true }),
    ]);
    await once.scheduler.postNow("st1");
    expect(once.deps.discardStory).toHaveBeenCalledOnce();

    // delete_after on a repeating story would remove the media it needs next time. The
    // API refuses to set it, and the scheduler refuses to act on it.
    const daily = harness({}, [story({ mode: "daily", delete_after: true })]);
    await daily.scheduler.postNow("st1");
    expect(daily.deps.discardStory).not.toHaveBeenCalled();
  });
});
