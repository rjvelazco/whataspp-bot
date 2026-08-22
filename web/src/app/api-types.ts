/**
 * Single source of truth for API payload types shared with the backend.
 *
 * These are re-exported (type-only) from the engine's domain model at
 * `src/domain/types.ts`, so the admin UI and the bot can never drift. No runtime
 * code crosses the boundary — only type information, which the build erases.
 * Add a shared shape here rather than re-declaring it inside a service.
 */
export type {
  FlowMenu,
  FlowOption,
  FlowAction,
  FlowIssue,
  CatalogItem,
  Variant,
  Order,
  OrderItem,
  OrderStatus,
  Asset,
  AssetCategory,
  Contact,
  StorySchedule,
  Store,
  StorePayments,
} from '../../../src/domain/types';
