-- Surf Salvaje · 003 · Trades públicos (tablón). Mismo modelo que sqlite/003_trade_listings.sql.
-- IF NOT EXISTS: se puede relanzar si algo se corta.

CREATE TABLE IF NOT EXISTS trade_listings (
  id            VARCHAR(36)  NOT NULL,
  user_id       VARCHAR(36)  NOT NULL,
  status        VARCHAR(12)  NOT NULL,
  request_id    VARCHAR(64)  NOT NULL,
  content_hash  CHAR(64)     NOT NULL,
  expires_at    BIGINT       NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_listing_request (user_id, request_id),
  KEY trade_listings_status (status, created_at),
  KEY trade_listings_user (user_id, status),
  CONSTRAINT fk_listing_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_listing_status CHECK (status IN ('OPEN','COMPLETED','CANCELED','EXPIRED','INVALID'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_listing_items (
  listing_id    VARCHAR(36)  NOT NULL,
  side          VARCHAR(8)   NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  PRIMARY KEY (listing_id, item_id),
  KEY trade_listing_items_item (item_id),
  CONSTRAINT fk_listing_item_listing FOREIGN KEY (listing_id) REFERENCES trade_listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_item_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT ck_listing_item_side CHECK (side IN ('OFFER','WANT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_listing_offers (
  offer_id      VARCHAR(36)  NOT NULL,
  listing_id    VARCHAR(36)  NOT NULL,
  PRIMARY KEY (offer_id),
  KEY trade_listing_offers_listing (listing_id),
  CONSTRAINT fk_listing_offer_offer FOREIGN KEY (offer_id) REFERENCES trade_offers(id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_offer_listing FOREIGN KEY (listing_id) REFERENCES trade_listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
