import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { logger } from "../logger.js";

/**
 * Thumbnails for uploaded images.
 *
 * The library grid renders every asset into a ~160px box, but it was requesting the
 * original — so a shop owner who uploads thirty photos from a phone makes the browser
 * download and downscale thirty multi-megabyte JPEGs to draw thirty postage stamps.
 *
 * Generated lazily on first request rather than at upload time, which means existing
 * assets are covered without a migration and an upload does not wait on image processing.
 * The result is cached on disk beside the original, so it happens once per asset.
 */

/** Longest edge, in pixels. Twice the ~160px the grid draws, so it stays sharp on 2x. */
const THUMB_MAX = 320;

/** WebP: markedly smaller than JPEG at this size, and every target browser reads it. */
const THUMB_QUALITY = 78;

/** `abc-123.jpg` -> `abc-123.thumb.webp`, so it sorts beside its original. */
export function thumbFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return `${base}.thumb.webp`;
}

/** Only raster images get one; a PDF has no thumbnail and the UI shows an icon instead. */
export function canThumbnail(mimetype: string): boolean {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(mimetype.split(";")[0].trim());
}

/**
 * The thumbnail's path, generating it if it does not exist yet.
 *
 * Returns null when the asset cannot have one, or when generation fails — a corrupt
 * upload should degrade to the full image, not take the request down.
 */
export async function ensureThumbnail(
  dir: string,
  filename: string,
  mimetype: string,
): Promise<string | null> {
  if (!canThumbnail(mimetype)) return null;

  const target = join(dir, thumbFilename(filename));
  if (existsSync(target)) return target;

  const source = join(dir, filename);
  if (!existsSync(source)) return null;

  // Write to a temporary name and rename in, so a concurrent request never reads a
  // half-written file.
  const staging = `${target}.tmp-${randomUUID()}`;
  try {
    await sharp(source)
      .rotate() // honour EXIF orientation; phone photos are routinely sideways without it
      .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(staging);
    renameSync(staging, target);
    return target;
  } catch (err) {
    rmSync(staging, { force: true });
    logger.warn({ err, filename }, "could not generate thumbnail");
    return null;
  }
}

/** Remove an asset's thumbnail, if it has one. Called when the asset itself is deleted. */
export function removeThumbnail(dir: string, filename: string): void {
  rmSync(join(dir, thumbFilename(filename)), { force: true });
}
