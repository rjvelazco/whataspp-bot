import { logger } from "../logger.js";
import type { Asset, Store, Story } from "../domain/types.js";

/**
 * Fold the retired store-wide story schedule into a single scheduled story.
 *
 * The old model was one `{ enabled, time }` on the store plus every asset in the
 * "story" category, posted together each day. The new model schedules each Status
 * separately, and Estados lists stories rather than loose uploads — so without this,
 * a shop owner's images would still exist as rows and simply stop being shown.
 *
 * All the existing assets become the media of **one** daily story rather than one story
 * each: that matches how the composer creates a story and how an owner thinks about
 * "my daily batch", and posting behaviour is unchanged either way, since each image was
 * already posted as its own Status.
 */

/** Key under which the marker is stored, so this can never fold twice. */
export const LEGACY_STORY_MIGRATION_KEY = "stories:folded_legacy_schedule";

export interface LegacyStoryMigrationDeps {
  getStore: () => Store | undefined;
  /** Whether this migration has already run, from a marker rather than from user data. */
  hasRun: () => boolean;
  /** Record that it ran, and stop the old setting being read again. */
  markRun: (store: Store) => void;
  /** Assets in the "story" category, for this store. */
  listStoryAssets: () => Asset[];
  /** Stories that already exist, so the migration can tell it has already run. */
  listStories: () => Story[];
  saveStory: (story: Story) => void;
  newId: () => string;
  now: () => Date;
}

const DEFAULT_TIME = "09:00";

/**
 * Returns the story it created, or null when there was nothing to do.
 *
 * Idempotence rests on a persisted marker, not on "the owner has no stories yet". The
 * latter is user data: deleting your only story took the count back to zero, and the
 * legacy `{ enabled: true }` was still sitting in the store row waiting to be read — so
 * the next orphaned upload would have been folded into a live daily story and started
 * broadcasting a file nobody scheduled.
 */
export function migrateLegacyStorySchedule(deps: LegacyStoryMigrationDeps): Story | null {
  if (deps.hasRun()) return null;
  const store = deps.getStore();
  if (!store) return null;
  if (deps.listStories().length > 0) {
    deps.markRun(store);
    return null;
  }

  const assets = deps.listStoryAssets();
  if (assets.length === 0) {
    deps.markRun(store);
    return null;
  }

  const legacy = store.story_schedule;
  const story: Story = {
    id: deps.newId(),
    store_id: store.store_id,
    caption: "",
    mode: "daily",
    weekdays: [],
    post_date: null,
    post_time: legacy?.time ?? DEFAULT_TIME,
    delete_after: false,
    // Inherit whether it was actually publishing. A store that never turned the old
    // schedule on must not start broadcasting because of a migration.
    enabled: legacy?.enabled ?? false,
    last_posted_at: null,
    created_at: deps.now().toISOString(),
    // Oldest first, so the order matches the order they were uploaded in.
    media: [...assets]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((asset, position) => ({ asset_id: asset.id, position })),
  };

  deps.saveStory(story);
  deps.markRun(store);
  logger.info(
    { story: story.id, media: story.media.length, enabled: story.enabled },
    "folded the legacy story schedule into one daily story",
  );
  return story;
}
