-- Surf Salvaje · 002 · Trade (intercambio de items entre cuentas registradas).
-- No se modifica ni se borra ninguna tabla anterior: el inventario y las compras pasan a tablas
-- _v2 (copiando los datos) porque las antiguas no admitían el origen 'TRADE' ni volver a comprar
-- un item que se entregó en un trade. user_inventory e item_purchases quedan como histórico.

-- Inventario: igual que user_inventory, con el origen TRADE.
CREATE TABLE user_inventory_v2 (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  source        TEXT NOT NULL CHECK (source IN ('PURCHASE','GIFT','MIGRATION','ADMIN','TRADE')),
  reference     TEXT,
  acquired_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, item_id)
);
INSERT OR IGNORE INTO user_inventory_v2 (user_id, item_id, source, reference, acquired_at)
  SELECT user_id, item_id, source, reference, acquired_at FROM user_inventory;
CREATE INDEX user_inventory_v2_item ON user_inventory_v2(item_id);

-- Compras: sin UNIQUE (user_id, item_id), para poder recomprar lo que se cambió. La propiedad
-- la decide el inventario; aquí solo queda el registro idempotente por request_id.
CREATE TABLE item_purchases_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  price_normal  INTEGER NOT NULL CHECK (price_normal >= 0),
  request_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, request_id)
);
INSERT OR IGNORE INTO item_purchases_v2 (id, user_id, item_id, price_normal, request_id, created_at)
  SELECT id, user_id, item_id, price_normal, request_id, created_at FROM item_purchases;

-- Código de surfista (p. ej. SURF-4F7KQ): así se encuentra a otro jugador (los nicks se repiten).
CREATE TABLE trade_profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_code   TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Ofertas. Son inmutables: cambiar algo es una contraoferta (parent_id) nueva.
CREATE TABLE trade_offers (
  id            TEXT PRIMARY KEY,                -- UUID
  from_user     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETED','DECLINED','CANCELED','EXPIRED','INVALID','COUNTERED','REVERTED')),
  parent_id     TEXT REFERENCES trade_offers(id),
  content_hash  TEXT NOT NULL,                   -- huella de lo que se ofrece y se pide
  request_id    TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,                -- epoch ms
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  TEXT,
  UNIQUE (from_user, request_id)
);
CREATE INDEX trade_offers_to ON trade_offers(to_user, status);
CREATE INDEX trade_offers_from ON trade_offers(from_user, status);

CREATE TABLE trade_offer_items (
  offer_id      TEXT NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  side          TEXT NOT NULL CHECK (side IN ('OFFER','REQUEST')),   -- OFFER = lo entrega from_user
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  PRIMARY KEY (offer_id, item_id)
);
CREATE INDEX trade_offer_items_item ON trade_offer_items(item_id);

-- Libro de movimientos de items: cada cambio de dueño deja una fila.
CREATE TABLE item_transfers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id      TEXT NOT NULL REFERENCES trade_offers(id),
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  from_user     TEXT NOT NULL REFERENCES users(id),
  to_user       TEXT NOT NULL REFERENCES users(id),
  reason        TEXT NOT NULL CHECK (reason IN ('TRADE','REVERT')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX item_transfers_trade ON item_transfers(trade_id);

-- Bloqueos: quien bloquea deja de recibir ofertas de esa cuenta.
CREATE TABLE trade_blocks (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, blocked_user_id)
);
