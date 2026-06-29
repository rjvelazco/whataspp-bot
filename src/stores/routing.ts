import { config } from "../config.js";
import { getStoreByAccount, getStoreById } from "../db/repositories.js";
import type { Store } from "../domain/types.js";

/**
 * Map the bot account a message arrived on → the store it belongs to.
 *
 * Pilot (Baileys): one process = one number, so we match by bound account_id and
 * fall back to STORE_ID. This same seam is where Cloud API multi-store routing by
 * phone_number_id plugs in — no engine changes.
 */
export function resolveStore(accountId: string): Store | undefined {
  return getStoreByAccount(accountId) ?? getStoreById(config.storeId);
}
