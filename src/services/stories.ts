import { rmSync } from "node:fs";
import { containedPath } from "../domain/uploads.js";
import { assetInUse, deleteAsset, deleteStory, getAsset, getStory } from "../db/repositories.js";
import { removeThumbnail } from "./thumbnails.js";
import { logger } from "../logger.js";
import type { Asset, Story } from "../domain/types.js";

/**
 * The media side of a story.
 *
 * A story's media are `assets` rows, but unlike a catalogue file they are not reachable
 * on their own — Estados lists stories, not loose uploads. So deleting a story has to
 * take its files with it, or they become invisible bytes on disk that nothing can ever
 * reference again.
 */

/** One media file, resolved to something the transport can send. */
export interface StoryMediaFile {
  asset: Asset;
  path: string;
}

/**
 * The story's media in posting order, skipping anything whose row or file has gone.
 *
 * A missing asset is logged rather than thrown: one deleted file should not stop the
 * rest of the Status going out.
 */
export function resolveStoryMedia(story: Story, assetsDir: string): StoryMediaFile[] {
  const files: StoryMediaFile[] = [];
  for (const item of story.media) {
    const asset = getAsset(item.asset_id);
    if (!asset) {
      logger.warn({ story: story.id, asset: item.asset_id }, "story media row has no asset");
      continue;
    }
    const path = containedPath(assetsDir, asset.filename);
    if (!path) {
      logger.warn({ story: story.id, asset: asset.id }, "story media filename is not contained");
      continue;
    }
    files.push({ asset, path });
  }
  return files;
}

/** Remove an asset's row, its file and its thumbnail. */
export function deleteAssetAndFile(asset: Asset, assetsDir: string): void {
  const path = containedPath(assetsDir, asset.filename);
  if (path) rmSync(path, { force: true });
  removeThumbnail(assetsDir, asset.filename);
  deleteAsset(asset.id);
}

/**
 * Delete a story, its media rows and the files behind them.
 *
 * Used by the delete button, and by a one-time story that was set to clean up after
 * publishing. Returns the number of media files removed.
 */
export function deleteStoryAndMedia(storyId: string, assetsDir: string): number {
  const story = getStory(storyId);
  if (!story) return 0;

  let removed = 0;
  for (const { asset } of resolveStoryMedia(story, assetsDir)) {
    // Nothing in the UI shares media between stories, but a file another story still
    // points at must survive this one.
    if (assetInUse(asset.id, story.id)) continue;
    deleteAssetAndFile(asset, assetsDir);
    removed += 1;
  }
  deleteStory(storyId); // story_media cascades
  logger.info({ story: storyId, removed }, "story deleted with its media");
  return removed;
}

/**
 * Delete the media an edit dropped from a story.
 *
 * PUT replaces the media list wholesale, so without this a file removed in the composer
 * keeps its assets row, belongs to no story, and can never be reached or deleted again.
 */
export function discardDroppedMedia(
  before: Story,
  keptAssetIds: string[],
  assetsDir: string,
): number {
  const kept = new Set(keptAssetIds);
  let removed = 0;
  for (const item of before.media) {
    if (kept.has(item.asset_id)) continue;
    if (assetInUse(item.asset_id, before.id)) continue;
    const asset = getAsset(item.asset_id);
    if (!asset) continue;
    deleteAssetAndFile(asset, assetsDir);
    removed += 1;
  }
  if (removed > 0) logger.info({ story: before.id, removed }, "removed media dropped from a story");
  return removed;
}
