/** Domain model — mirrors the data shapes in whatsapp-store-bot-mvp-spec.md §3. */

/** The per-customer conversation state (§3.4). */
export type ConvState =
  | "idle"
  | "in_menu"
  | "browsing"
  | "choosing_category"
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

/** Daily auto-post of "story" assets as WhatsApp Status (Estados). */
export interface StorySchedule {
  enabled: boolean;
  /** Local time "HH:MM" (24h) when stories post each day, e.g. "09:00". */
  time: string;
}

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
  /** Daily WhatsApp Status auto-post config (edited from the admin panel). */
  story_schedule?: StorySchedule;
}

export type OrderStatus =
  | "pending_payment"
  | "payment_submitted"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

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

/** Actions an editable menu option can trigger (bot flow builder). */
export type FlowAction =
  | "go_menu"
  | "start_order"
  | "show_category"
  | "shipping_payments"
  | "talk_human";

export interface FlowOption {
  label: string;
  action: FlowAction;
  /** Menu key (go_menu) or category name (show_category); unused otherwise. */
  target?: string;
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

export type AssetCategory = "catalog" | "promo" | "story";

/** An uploaded file (catalog/menu or promo/flyer) stored under uploads/assets/. */
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
