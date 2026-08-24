import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import {
  canThumbnail,
  ensureThumbnail,
  removeThumbnail,
  thumbFilename,
} from "../src/services/thumbnails.js";

/** A believable phone photo: large enough that serving it as a 160px tile is the bug. */
async function writePhoto(dir: string, name: string, width = 3000, height = 2000): Promise<number> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  writeFileSync(join(dir, name), buffer);
  return buffer.length;
}

describe("thumbFilename", () => {
  it("sits beside the original and is always webp", () => {
    expect(thumbFilename("abc-123.jpg")).toBe("abc-123.thumb.webp");
    expect(thumbFilename("abc-123.png")).toBe("abc-123.thumb.webp");
  });

  it("copes with a name that has no extension", () => {
    expect(thumbFilename("abc-123")).toBe("abc-123.thumb.webp");
  });
});

describe("canThumbnail", () => {
  it("accepts the raster types the uploader allows", () => {
    for (const t of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "IMAGE/JPEG",
      "image/jpeg; charset=x",
    ]) {
      expect(canThumbnail(t)).toBe(true);
    }
  });

  it("rejects anything without pixels", () => {
    expect(canThumbnail("application/pdf")).toBe(false);
    expect(canThumbnail("video/mp4")).toBe(false);
    expect(canThumbnail("")).toBe(false);
  });
});

describe("ensureThumbnail", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "thumbs-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("turns a multi-megapixel photo into something worth sending to a 160px tile", async () => {
    const originalBytes = await writePhoto(dir, "big.jpg");
    const thumb = await ensureThumbnail(dir, "big.jpg", "image/jpeg");

    expect(thumb).toBe(join(dir, "big.thumb.webp"));
    const meta = await sharp(thumb!).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(320);
    // The point of the exercise: an order of magnitude less to download, at least.
    expect(statSync(thumb!).size).toBeLessThan(originalBytes / 10);
  });

  it("never enlarges an image that is already small", async () => {
    await writePhoto(dir, "small.jpg", 80, 60);
    const thumb = await ensureThumbnail(dir, "small.jpg", "image/jpeg");
    const meta = await sharp(thumb!).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(60);
  });

  it("reuses the cached file instead of re-encoding", async () => {
    await writePhoto(dir, "cache.jpg", 900, 600);
    const first = await ensureThumbnail(dir, "cache.jpg", "image/jpeg");
    const stamp = statSync(first!).mtimeMs;
    const bytes = readFileSync(first!);

    const second = await ensureThumbnail(dir, "cache.jpg", "image/jpeg");

    expect(second).toBe(first);
    expect(statSync(second!).mtimeMs).toBe(stamp);
    expect(readFileSync(second!)).toEqual(bytes);
  });

  it("returns null for a file that has no pixels", async () => {
    writeFileSync(join(dir, "doc.pdf"), "%PDF-1.4");
    expect(await ensureThumbnail(dir, "doc.pdf", "application/pdf")).toBeNull();
  });

  it("returns null rather than throwing when the source is missing", async () => {
    expect(await ensureThumbnail(dir, "gone.jpg", "image/jpeg")).toBeNull();
  });

  it("returns null and leaves no debris when the source is not a real image", async () => {
    // An upload that claims image/jpeg but is not one must degrade, not take out the route.
    writeFileSync(join(dir, "lies.jpg"), "this is not a jpeg");
    expect(await ensureThumbnail(dir, "lies.jpg", "image/jpeg")).toBeNull();
    expect(existsSync(join(dir, "lies.thumb.webp"))).toBe(false);
    // No staging file left behind either.
    expect(readFileSync(join(dir, "lies.jpg"), "utf8")).toBe("this is not a jpeg");
  });

  it("removeThumbnail deletes it and is safe when there is none", async () => {
    await writePhoto(dir, "gone.jpg", 500, 500);
    const thumb = await ensureThumbnail(dir, "gone.jpg", "image/jpeg");
    expect(existsSync(thumb!)).toBe(true);

    removeThumbnail(dir, "gone.jpg");
    expect(existsSync(thumb!)).toBe(false);
    expect(() => removeThumbnail(dir, "never-existed.jpg")).not.toThrow();
  });
});
