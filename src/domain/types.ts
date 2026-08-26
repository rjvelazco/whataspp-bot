/** Domain model — mirrors the data shapes in whatsapp-store-bot-mvp-spec.md §3. */

/** The per-customer conversation state (§3.4). */
export type ConvState =
  | "idle"
  | "in_menu"
  | "browsing"
  | "checking_size"
  | "ordering_size"
  | "ordering_color"
  | "ordering_qty"
  | "ordering_name"
  | "ordering_address"
  | "confirming"
  | "awaiting_payment"
  | "paused";

export interface Variant {
  size: string;
  color: string;
  stock: number;
}

export interface CatalogItem {
  item_id: string;
  store_id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  photo_url: string;
  active: boolean;
  variants: Variant[];
}

export interface SizeGuideEntry {
  size: string;
  busto: number;
  cintura: number;
}

export interface StorePayments {
  pago_movil?: string;
  zelle?: string;
  binance?: string;
}

/**
 * Daily auto-post of "story" assets as WhatsApp Status (Estados).
 *
 * @deprecated Superseded by the `stories` table, which schedules each Status
 * separately. Still read once at boot to fold the old setting into a story; nothing
 * writes it any more.
 */
export interface StorySchedule {
  enabled: boolean;
  /** Local time "HH:MM" (24h) when stories post each day, e.g. "09:00". */
  time: string;
}

/** Why a publish attempt ended the way it did. */
export type StoryPostReason = "ok" | "disconnected" | "no_media" | "busy" | "not_found";

export interface StoryPostResult {
  posted: number;
  /** How many contacts the Status was sent to. */
  audience: number;
  reason: StoryPostReason;
}

/** How often a story republishes. */
export type StoryMode = "daily" | "weekly" | "once";

/** One media file in a story, in the order it posts. */
export interface StoryMediaItem {
  asset_id: string;
  position: number;
}

/**
 * A scheduled WhatsApp Status: some media, a caption, and when it goes out.
 *
 * Replaces the single store-wide `story_schedule`, which posted every story asset
 * every day at one time and kept its "already posted today" guard in memory — so a
 * restart re-posted the day's Status to every customer.
 */
export interface Story {
  id: string;
  store_id: string;
  caption: string;
  mode: StoryMode;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. Only read when mode is "weekly". */
  weekdays: number[];
  /** Local date "YYYY-MM-DD". Only read when mode is "once". */
  post_date: string | null;
  /** Local time "HH:MM" (24h). */
  post_time: string;
  /**
   * Delete the media once it has published. Only offered for "once" — on a repeating
   * story it would delete the files it needs for the next run.
   */
  delete_after: boolean;
  enabled: boolean;
  /** ISO timestamp of the last successful publish; the once-per-day guard reads this. */
  last_posted_at: string | null;
  created_at: string;
  /** The media, in posting order. */
  media: StoryMediaItem[];
}

/**
 * The words a customer can type to reach each canned answer.
 *
 * Editable from Tienda. These used to be a hardcoded array in the UI *and* a separate
 * hardcoded array in the engine, and the two had already drifted — the engine matched
 * four rate words while the panel showed two. One place now, and the panel edits the
 * same list the bot reads.
 */
export interface StoreKeywords {
  rate: string[];
  address: string[];
  shipping: string[];
  payment: string[];
  offers: string[];
  hours: string[];
}

export type KeywordTopic = keyof StoreKeywords;

/**
 * Where the rate the bot quotes comes from.
 *
 * The first three are fetched; "custom" is whatever the owner typed and is never
 * overwritten by a refresh.
 */
export type RateSource = "usd_oficial" | "usd_paralelo" | "eur_oficial" | "custom";

/** Per-store config — the "build once" payoff (§3.1). */
export interface Store {
  store_id: string;
  store_name: string;
  owner_name: string;
  owner_whatsapp: string;
  /** Baileys: the bot's own WhatsApp jid. Cloud API: the phone_number_id. Optional for pilot. */
  account_id?: string;
  hours: string;
  delivery_info: string;
  returns_policy: string;
  payments: StorePayments;
  size_guide: SizeGuideEntry[];
  categories: string[];
  /** Physical store address (shown for the `dirección` keyword). */
  address?: string;
  /** Optional Google Maps link paired with the address. */
  maps_url?: string;
  /** USD→Bs exchange rate (Bs per $1), edited manually from the admin. */
  usd_rate?: number;
  /** ISO timestamp of the last usd_rate update, for display. */
  usd_rate_updated_at?: string;
  /** Which rate the bot quotes. Defaults to the official dollar. */
  rate_source?: RateSource;
  /** The owner's own name for a "custom" rate, e.g. "Tasa de la tienda". */
  rate_label?: string;
  /**
   * When the last automatic refresh failed. The stored rate is still the last good
   * one, so the panel can say it is stale instead of pretending it is current.
   */
  rate_failed_at?: string;
  /** The words customers can type to reach each canned answer. */
  keywords?: StoreKeywords;
  /** Daily WhatsApp Status auto-post config (edited from the admin panel). */
  story_schedule?: StorySchedule;
}

export type OrderStatus =
  "pending_payment" | "payment_submitted" | "confirmed" | "shipped" | "delivered" | "cancelled";

export interface OrderItem {
  code: string;
  /** Product display name, captured at order time (older orders may lack it). */
  name?: string;
  size: string;
  color: string;
  qty: number;
  price: number;
}

export interface Order {
  order_id: string;
  store_id: string;
  customer_wa: string;
  customer_name: string;
  items: OrderItem[];
  delivery_address: string;
  subtotal: number;
  status: OrderStatus;
  receipt_url?: string | null;
  created_at: string;
}

/** Work-in-progress order accumulated across the ordering states. */
export interface DraftOrder {
  code?: string;
  name?: string;
  price?: number;
  size?: string | null;
  color?: string | null;
  qty?: number | null;
  customer_name?: string | null;
  delivery_address?: string | null;
}

/**
 * Every action a menu option can run (bot flow builder). Exported as a runtime list because menus
 * are stored JSON that has to be validated on the way in; the type is derived
 * from it so the two can never drift.
 */
export const FLOW_ACTIONS = [
  "go_menu",
  "start_order",
  "show_category",
  "show_offers",
  "show_payment",
  "show_shipping",
  "show_address",
  "show_rate",
  "size_guide",
  "shipping_payments", // legacy combined view — kept for existing menus
  "talk_human",
] as const;

export type FlowAction = (typeof FLOW_ACTIONS)[number];

export interface FlowOption {
  label: string;
  action: FlowAction;
  /** Menu key to navigate to — only for action 'go_menu'. */
  target?: string;
  /** Action data — e.g. the category name for 'show_category'. */
  value?: string;
}

/** A configurable bot menu: a message + a set of options. Stored per store. */
export interface FlowMenu {
  key: string;
  name: string;
  trigger?: string;
  message: string;
  options: FlowOption[];
  /** Asset ids (catalog/promo/story) sent alongside the message. */
  attachments?: string[];
}

/** A problem found by validateFlow. error = block the save; warning = advisory. */
export interface FlowIssue {
  severity: "error" | "warning";
  /** The menu the issue belongs to (omitted for flow-wide issues). */
  menuKey?: string;
  message: string;
}

/**
 * What an uploaded file is for.
 *
 * "promo" was retired: it held flyers in a section of its own that duplicated the
 * catalogue's purpose without earning the space. Existing promo rows are folded into
 * "catalog" on boot — see migratePromoAssets.
 */
export type AssetCategory = "catalog" | "story";

/** An uploaded file (a catalogue document, or an image to post as a Status). */
export interface Asset {
  id: string;
  store_id: string;
  category: AssetCategory;
  filename: string;
  original_name: string;
  mimetype: string;
  size: number;
  created_at: string;
}

/** A number that has messaged the bot — the audience for Status / broadcasts. */
export interface Contact {
  store_id: string;
  wa_jid: string;
  phone: string | null;
  name: string | null;
  first_seen: string;
  last_seen: string;
}

export interface Conversation {
  customer_wa: string;
  store_id: string;
  state: ConvState;
  draft_order: DraftOrder;
  /** The configured menu currently shown (for interpreting numbered replies). */
  menu_key: string | null;
  /** The order currently awaiting payment, so a receipt photo can be attached. */
  active_order_id: string | null;
  bot_paused_until: string | null;
  updated_at: string;
}
