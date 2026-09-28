-- Surf Salvaje · 002 · Trade (MySQL 5.7+/8 · MariaDB 10.3+). Mismo modelo que sqlite/002_trade.sql.
-- No se modifica ni se borra ninguna tabla anterior: inventario y compras pasan a tablas _v2
-- (copiando los datos) para admitir el origen 'TRADE' y la recompra de un item cambiado.
-- IF NOT EXISTS / INSERT IGNORE: se puede relanzar si algo se corta.

CREATE TABLE IF NOT EXISTS user_inventory_v2 (
  user_id       VARCHAR(36)  NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  source        VARCHAR(16)  NOT NULL,
  reference     VARCHAR(128) NULL,
  acquired_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, item_id),
  KEY user_inventory_v2_item (item_id),
  CONSTRAINT fk_inv2_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv2_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT ck_inv2_source CHECK (source IN ('PURCHASE','GIFT','MIGRATION','ADMIN','TRADE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO user_inventory_v2 (user_id, item_id, source, reference, acquired_at)
  SELECT user_id, item_id, source, reference, acquired_at FROM user_inventory;

CREATE TABLE IF NOT EXISTS item_purchases_v2 (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       VARCHAR(36)  NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  price_normal  BIGINT       NOT NULL,
  request_id    VARCHAR(64)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_purchase2_request (user_id, request_id),
  CONSTRAINT fk_purchase2_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase2_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT ck_purchase2_price CHECK (price_normal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO item_purchases_v2 (id, user_id, item_id, price_normal, request_id, created_at)
  SELECT id, user_id, item_id, price_normal, request_id, created_at FROM item_purchases;

CREATE TABLE IF NOT EXISTS trade_profiles (
  user_id       VARCHAR(36)  NOT NULL,
  public_code   VARCHAR(16)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_trade_code (public_code),
  CONSTRAINT fk_trade_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_offers (
  id            VARCHAR(36)  NOT NULL,
  from_user     VARCHAR(36)  NOT NULL,
  to_user       VARCHAR(36)  NOT NULL,
  status        VARCHAR(12)  NOT NULL,
  parent_id     VARCHAR(36)  NULL,
  content_hash  CHAR(64)     NOT NULL,
  request_id    VARCHAR(64)  NOT NULL,
  expires_at    BIGINT       NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at  DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trade_request (from_user, request_id),
  KEY trade_offers_to (to_user, status),
  KEY trade_offers_from (from_user, status),
  CONSTRAINT fk_trade_from FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_to FOREIGN KEY (to_user) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_parent FOREIGN KEY (parent_id) REFERENCES trade_offers(id),
  CONSTRAINT ck_trade_status CHECK (status IN ('OPEN','COMPLETED','DECLINED','CANCELED','EXPIRED','INVALID','COUNTERED','REVERTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_offer_items (
  offer_id      VARCHAR(36)  NOT NULL,
  side          VARCHAR(8)   NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  PRIMARY KEY (offer_id, item_id),
  KEY trade_offer_items_item (item_id),
  CONSTRAINT fk_trade_item_offer FOREIGN KEY (offer_id) REFERENCES trade_offers(id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_item_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT ck_trade_item_side CHECK (side IN ('OFFER','REQUEST'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_transfers (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  trade_id      VARCHAR(36)  NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  from_user     VARCHAR(36)  NOT NULL,
  to_user       VARCHAR(36)  NOT NULL,
  reason        VARCHAR(8)   NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY item_transfers_trade (trade_id),
  CONSTRAINT fk_transfer_trade FOREIGN KEY (trade_id) REFERENCES trade_offers(id),
  CONSTRAINT fk_transfer_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT fk_transfer_from FOREIGN KEY (from_user) REFERENCES users(id),
  CONSTRAINT fk_transfer_to FOREIGN KEY (to_user) REFERENCES users(id),
  CONSTRAINT ck_transfer_reason CHECK (reason IN ('TRADE','REVERT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_blocks (
  user_id         VARCHAR(36) NOT NULL,
  blocked_user_id VARCHAR(36) NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, blocked_user_id),
  CONSTRAINT fk_block_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_block_blocked FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
