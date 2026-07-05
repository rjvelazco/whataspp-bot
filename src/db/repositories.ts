import { db } from "./index.js";
import type {
  Asset,
  CatalogItem,
  Conversation,
  ConvState,
  FlowMenu,
  Order,
  OrderStatus,
  Store,
} from "../domain/types.js";

// ---------- stores ----------

export function upsertStore(store: Store): void {
  db.prepare(
    `INSERT INTO stores (store_id, account_id, config_json)
     VALUES (@store_id, @account_id, @config_json)
     ON CONFLICT(store_id) DO UPDATE SET
       account_id = excluded.account_id,
       config_json = excluded.config_json`,
  ).run({
    store_id: store.store_id,
    account_id: store.account_id ?? null,
    config_json: JSON.stringify(store),
  });
}

export function getStoreById(storeId: string): Store | undefined {
  const row = db.prepare(`SELECT config_json FROM stores WHERE store_id = ?`).get(storeId) as
    | { config_json: string }
    | undefined;
  return row ? (JSON.parse(row.config_json) as Store) : undefined;
}

export function getStoreByAccount(accountId: string): Store | undefined {
  const row = db.prepare(`SELECT config_json FROM stores WHERE account_id = ?`).get(accountId) as
    | { config_json: string }
    | undefined;
  return row ? (JSON.parse(row.config_json) as Store) : undefined;
}

// ---------- catalog ----------

export function replaceCatalog(storeId: string, items: CatalogItem[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM catalog_items WHERE store_id = ?`).run(storeId);
    const insert = db.prepare(
      `INSERT INTO catalog_items (item_id, store_id, code, category, active, data_json)
       VALUES (@item_id, @store_id, @code, @category, @active, @data_json)`,
    );
    for (const item of items) {
      insert.run({
        item_id: item.item_id,
        store_id: storeId,
        code: item.code,
        category: item.category,
        active: item.active ? 1 : 0,
        data_json: JSON.stringify(item),
      });
    }
  });
  tx();
}

function parseItem(row: { data_json: string }): CatalogItem {
  return JSON.parse(row.data_json) as CatalogItem;
}

export function getItemsByCategory(storeId: string, category: string): CatalogItem[] {
  const rows = db
    .prepare(`SELECT data_json FROM catalog_items WHERE store_id = ? AND category = ? AND active = 1`)
    .all(storeId, category) as { data_json: string }[];
  return rows.map(parseItem);
}

export function getItemByCode(storeId: string, code: string): CatalogItem | undefined {
  const row = db
    .prepare(`SELECT data_json FROM catalog_items WHERE store_id = ? AND code = ?`)
    .get(storeId, code.toUpperCase()) as { data_json: string } | undefined;
  return row ? parseItem(row) : undefined;
}

export function getAllItems(storeId: string): CatalogItem[] {
  const rows = db
    .prepare(`SELECT data_json FROM catalog_items WHERE store_id = ? AND active = 1`)
    .all(storeId) as { data_json: string }[];
  return rows.map(parseItem);
}

// ---------- orders ----------

/** Create an order, assigning a human-friendly sequential order_id. */
export function createOrder(
  draft: Omit<Order, "order_id" | "created_at">,
  createdAt: string,
): Order {
  const seqRow = db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM orders`).get() as {
    next: number;
  };
  const orderId = String(1000 + seqRow.next);
  const order: Order = { ...draft, order_id: orderId, created_at: createdAt };
  db.prepare(
    `INSERT INTO orders (order_id, store_id, customer_wa, status, data_json, created_at)
     VALUES (@order_id, @store_id, @customer_wa, @status, @data_json, @created_at)`,
  ).run({
    order_id: order.order_id,
    store_id: order.store_id,
    customer_wa: order.customer_wa,
    status: order.status,
    data_json: JSON.stringify(order),
    created_at: order.created_at,
  });
  return order;
}

/** All orders for a store, newest first. */
export function listOrders(storeId: string): Order[] {
  const rows = db
    .prepare(`SELECT data_json FROM orders WHERE store_id = ? ORDER BY seq DESC`)
    .all(storeId) as { data_json: string }[];
  return rows.map((r) => JSON.parse(r.data_json) as Order);
}

export function getOrder(orderId: string): Order | undefined {
  const row = db.prepare(`SELECT data_json FROM orders WHERE order_id = ?`).get(orderId) as
    | { data_json: string }
    | undefined;
  return row ? (JSON.parse(row.data_json) as Order) : undefined;
}

export function updateOrder(order: Order): void {
  db.prepare(`UPDATE orders SET status = @status, data_json = @data_json WHERE order_id = @order_id`).run(
    {
      order_id: order.order_id,
      status: order.status,
      data_json: JSON.stringify(order),
    },
  );
}

export function setOrderStatus(orderId: string, status: OrderStatus): void {
  const order = getOrder(orderId);
  if (!order) return;
  updateOrder({ ...order, status });
}

// ---------- assets ----------

export function createAsset(asset: Asset): void {
  db.prepare(
    `INSERT INTO assets (id, store_id, category, filename, original_name, mimetype, size, created_at)
     VALUES (@id, @store_id, @category, @filename, @original_name, @mimetype, @size, @created_at)`,
  ).run(asset);
}

export function listAssets(storeId: string): Asset[] {
  return db
    .prepare(`SELECT * FROM assets WHERE store_id = ? ORDER BY created_at DESC`)
    .all(storeId) as Asset[];
}

export function getAsset(id: string): Asset | undefined {
  return db.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as Asset | undefined;
}

export function deleteAsset(id: string): void {
  db.prepare(`DELETE FROM assets WHERE id = ?`).run(id);
}

// ---------- menus (flow builder) ----------

export function getMenus(storeId: string): FlowMenu[] {
  const row = db.prepare(`SELECT data_json FROM menus WHERE store_id = ?`).get(storeId) as
    | { data_json: string }
    | undefined;
  return row ? (JSON.parse(row.data_json) as FlowMenu[]) : [];
}

export function saveMenus(storeId: string, menus: FlowMenu[]): void {
  db.prepare(
    `INSERT INTO menus (store_id, data_json) VALUES (?, ?)
     ON CONFLICT(store_id) DO UPDATE SET data_json = excluded.data_json`,
  ).run(storeId, JSON.stringify(menus));
}

// ---------- conversations ----------

export function getConversation(customerWa: string, storeId: string): Conversation | undefined {
  const row = db
    .prepare(`SELECT * FROM conversations WHERE customer_wa = ? AND store_id = ?`)
    .get(customerWa, storeId) as
    | {
        customer_wa: string;
        store_id: string;
        state: string;
        draft_json: string;
        menu_key: string | null;
        active_order_id: string | null;
        bot_paused_until: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    customer_wa: row.customer_wa,
    store_id: row.store_id,
    state: row.state as ConvState,
    draft_order: JSON.parse(row.draft_json),
    menu_key: row.menu_key,
    active_order_id: row.active_order_id,
    bot_paused_until: row.bot_paused_until,
    updated_at: row.updated_at,
  };
}

export function saveConversation(conv: Conversation): void {
  db.prepare(
    `INSERT INTO conversations (customer_wa, store_id, state, draft_json, menu_key, active_order_id, bot_paused_until, updated_at)
     VALUES (@customer_wa, @store_id, @state, @draft_json, @menu_key, @active_order_id, @bot_paused_until, @updated_at)
     ON CONFLICT(customer_wa, store_id) DO UPDATE SET
       state = excluded.state,
       draft_json = excluded.draft_json,
       menu_key = excluded.menu_key,
       active_order_id = excluded.active_order_id,
       bot_paused_until = excluded.bot_paused_until,
       updated_at = excluded.updated_at`,
  ).run({
    customer_wa: conv.customer_wa,
    store_id: conv.store_id,
    state: conv.state,
    draft_json: JSON.stringify(conv.draft_order),
    menu_key: conv.menu_key,
    active_order_id: conv.active_order_id,
    bot_paused_until: conv.bot_paused_until,
    updated_at: conv.updated_at,
  });
}
