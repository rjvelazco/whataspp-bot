/** Domain model — mirrors the data shapes in whatsapp-store-bot-mvp-spec.md §3. */

/** The per-customer conversation state (§3.4). */
export type ConvState =
  | "idle"
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

export interface Conversation {
  customer_wa: string;
  store_id: string;
  state: ConvState;
  draft_order: DraftOrder;
  /** The order currently awaiting payment, so a receipt photo can be attached. */
  active_order_id: string | null;
  bot_paused_until: string | null;
  updated_at: string;
}
