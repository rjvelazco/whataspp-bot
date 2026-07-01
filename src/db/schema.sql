-- Generic engine, per-store data. Nested structures (variants, payments,
-- size_guide, order items, draft) are stored as JSON in *_json columns.

CREATE TABLE IF NOT EXISTS stores (
  store_id    TEXT PRIMARY KEY,
  account_id  TEXT,                 -- bot WhatsApp jid (Baileys) / phone_number_id (Cloud API)
  config_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stores_account ON stores(account_id);

CREATE TABLE IF NOT EXISTS catalog_items (
  item_id   TEXT PRIMARY KEY,
  store_id  TEXT NOT NULL,
  code      TEXT NOT NULL,
  category  TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_store_cat  ON catalog_items(store_id, category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_store_code ON catalog_items(store_id, code);

CREATE TABLE IF NOT EXISTS orders (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT UNIQUE NOT NULL,
  store_id    TEXT NOT NULL,
  customer_wa TEXT NOT NULL,
  status      TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, status);

CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL,
  category      TEXT NOT NULL,   -- 'catalog' | 'promo'
  filename      TEXT NOT NULL,   -- stored filename under uploads/assets/
  original_name TEXT NOT NULL,
  mimetype      TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_store ON assets(store_id, category);

CREATE TABLE IF NOT EXISTS menus (
  store_id  TEXT PRIMARY KEY,
  data_json TEXT NOT NULL   -- JSON array of FlowMenu
);

CREATE TABLE IF NOT EXISTS conversations (
  customer_wa      TEXT NOT NULL,
  store_id         TEXT NOT NULL,
  state            TEXT NOT NULL,
  draft_json       TEXT NOT NULL DEFAULT '{}',
  active_order_id  TEXT,
  bot_paused_until TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (customer_wa, store_id)
);
