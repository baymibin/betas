-- Surf Salvaje · 001 · Cuentas, identidades, sesiones y economía base (MySQL 5.7+/8 · MariaDB 10.3+).
-- Mismo modelo que migrations/sqlite/001_accounts_economy.sql. InnoDB + utf8mb4.
-- Cantidades de monedas: BIGINT (nunca coma flotante). Fechas: DATETIME(3) en UTC.
-- IF NOT EXISTS: en MySQL el DDL no es transaccional; si algo se corta, se puede relanzar.

CREATE TABLE IF NOT EXISTS users (
  id             VARCHAR(36)  NOT NULL,
  nickname       VARCHAR(64)  NOT NULL,
  avatar_url     VARCHAR(512) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  local_migrated TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_identities (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       VARCHAR(36)  NOT NULL,
  provider      VARCHAR(16)  NOT NULL,
  subject       VARCHAR(128) NOT NULL,
  display_name  VARCHAR(128) NULL,
  avatar_url    VARCHAR(512) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_identity (provider, subject),
  UNIQUE KEY uq_user_provider (user_id, provider),
  CONSTRAINT fk_identity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_identity_provider CHECK (provider IN ('google','discord'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    CHAR(64)     NOT NULL,
  user_id       VARCHAR(36)  NOT NULL,
  csrf_token    VARCHAR(64)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    BIGINT       NOT NULL,
  PRIMARY KEY (token_hash),
  KEY sessions_user (user_id),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash    CHAR(64)     NOT NULL,
  provider      VARCHAR(16)  NOT NULL,
  mode          VARCHAR(8)   NOT NULL,
  link_user_id  VARCHAR(36)  NULL,
  code_verifier VARCHAR(128) NOT NULL,
  nonce         VARCHAR(64)  NOT NULL,
  browser_hash  CHAR(64)     NOT NULL,
  expires_at    BIGINT       NOT NULL,
  PRIMARY KEY (state_hash),
  CONSTRAINT fk_state_user FOREIGN KEY (link_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_state_mode CHECK (mode IN ('login','link'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id       VARCHAR(36)  NOT NULL,
  settings_json TEXT         NOT NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallets (
  user_id       VARCHAR(36)  NOT NULL,
  currency      VARCHAR(16)  NOT NULL,
  balance       BIGINT       NOT NULL DEFAULT 0,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, currency),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_wallet_currency CHECK (currency IN ('NORMAL_COIN','GOLD_COIN')),
  CONSTRAINT ck_wallet_balance CHECK (balance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       VARCHAR(36)  NOT NULL,
  currency      VARCHAR(16)  NOT NULL,
  amount        BIGINT       NOT NULL,
  balance_after BIGINT       NOT NULL,
  type          VARCHAR(24)  NOT NULL,
  reference     VARCHAR(128) NOT NULL,
  description   VARCHAR(255) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wallet_operation (user_id, currency, type, reference),
  KEY wallet_transactions_user (user_id, id),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_tx_currency CHECK (currency IN ('NORMAL_COIN','GOLD_COIN')),
  CONSTRAINT ck_tx_amount CHECK (amount <> 0),
  CONSTRAINT ck_tx_balance CHECK (balance_after >= 0),
  CONSTRAINT ck_tx_type CHECK (type IN ('RACE_REWARD','ITEM_PURCHASE','GOLD_EXCHANGE','GOLD_CREDIT','GOLD_REFUND','ADMIN_ADJUSTMENT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_items (
  id            VARCHAR(32)  NOT NULL,
  category      VARCHAR(16)  NOT NULL,
  asset_index   INT          NOT NULL,
  name          VARCHAR(64)  NOT NULL,
  description   VARCHAR(255) NULL,
  asset         VARCHAR(255) NULL,
  price_normal  BIGINT       NOT NULL DEFAULT 0,
  available     TINYINT      NOT NULL DEFAULT 1,
  unique_owner  TINYINT      NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_slot (category, asset_index),
  CONSTRAINT ck_item_category CHECK (category IN ('character','board','wing','hat')),
  CONSTRAINT ck_item_price CHECK (price_normal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_inventory (
  user_id       VARCHAR(36)  NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  source        VARCHAR(16)  NOT NULL,
  reference     VARCHAR(128) NULL,
  acquired_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, item_id),
  CONSTRAINT fk_inv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT ck_inv_source CHECK (source IN ('PURCHASE','GIFT','MIGRATION','ADMIN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipped_items (
  user_id       VARCHAR(36)  NOT NULL,
  slot          VARCHAR(16)  NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, slot),
  CONSTRAINT fk_eq_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_eq_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT ck_eq_slot CHECK (slot IN ('character','board','wing','hat'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_purchases (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       VARCHAR(36)  NOT NULL,
  item_id       VARCHAR(32)  NOT NULL,
  price_normal  BIGINT       NOT NULL,
  request_id    VARCHAR(64)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_purchase_request (user_id, request_id),
  UNIQUE KEY uq_purchase_item (user_id, item_id),
  CONSTRAINT fk_purchase_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_item FOREIGN KEY (item_id) REFERENCES shop_items(id),
  CONSTRAINT ck_purchase_price CHECK (price_normal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coin_exchange_packages (
  id            VARCHAR(32)  NOT NULL,
  name          VARCHAR(64)  NOT NULL,
  normal_amount BIGINT       NOT NULL,
  gold_price    BIGINT       NULL,
  active        TINYINT      NOT NULL DEFAULT 0,
  sort_order    INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT ck_pack_amount CHECK (normal_amount > 0),
  CONSTRAINT ck_pack_price CHECK (gold_price IS NULL OR gold_price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coin_exchange_transactions (
  id              BIGINT      NOT NULL AUTO_INCREMENT,
  user_id         VARCHAR(36) NOT NULL,
  package_id      VARCHAR(32) NOT NULL,
  gold_spent      BIGINT      NOT NULL,
  normal_received BIGINT      NOT NULL,
  request_id      VARCHAR(64) NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_exchange_request (user_id, request_id),
  CONSTRAINT fk_exchange_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_exchange_package FOREIGN KEY (package_id) REFERENCES coin_exchange_packages(id),
  CONSTRAINT ck_exchange_gold CHECK (gold_spent > 0),
  CONSTRAINT ck_exchange_normal CHECK (normal_received > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_products (
  id             VARCHAR(32) NOT NULL,
  name           VARCHAR(64) NOT NULL,
  gold_amount    BIGINT      NOT NULL,
  price_minor    BIGINT      NULL,
  price_currency VARCHAR(8)  NULL,
  active         TINYINT     NOT NULL DEFAULT 0,
  sort_order     INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT ck_product_gold CHECK (gold_amount > 0),
  CONSTRAINT ck_product_price CHECK (price_minor IS NULL OR price_minor > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_orders (
  id            VARCHAR(64)  NOT NULL,
  user_id       VARCHAR(36)  NOT NULL,
  product_id    VARCHAR(32)  NOT NULL,
  provider      VARCHAR(32)  NOT NULL,
  provider_ref  VARCHAR(128) NULL,
  amount_minor  BIGINT       NOT NULL,
  currency      VARCHAR(8)   NOT NULL,
  gold_amount   BIGINT       NOT NULL,
  status        VARCHAR(16)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_provider (provider, provider_ref),
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_order_product FOREIGN KEY (product_id) REFERENCES payment_products(id),
  CONSTRAINT ck_order_amount CHECK (amount_minor > 0),
  CONSTRAINT ck_order_gold CHECK (gold_amount > 0),
  CONSTRAINT ck_order_status CHECK (status IN ('CREATED','PENDING','PAID','CREDITED','FAILED','CANCELED','REFUNDED','CHARGEBACK'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_events (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  provider      VARCHAR(32)  NOT NULL,
  event_id      VARCHAR(128) NOT NULL,
  order_id      VARCHAR(64)  NULL,
  type          VARCHAR(64)  NOT NULL,
  payload       MEDIUMTEXT   NOT NULL,
  received_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_event (provider, event_id),
  CONSTRAINT fk_event_order FOREIGN KEY (order_id) REFERENCES payment_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS race_rewards (
  user_id       VARCHAR(36)  NOT NULL,
  race_id       VARCHAR(64)  NOT NULL,
  place         INT          NOT NULL,
  amount        BIGINT       NOT NULL,
  day           CHAR(10)     NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, race_id),
  KEY race_rewards_day (user_id, day),
  CONSTRAINT fk_reward_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_reward_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
