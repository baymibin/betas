-- Surf Salvaje · 004 · Panel administrativo. Mismo modelo que sqlite/004_admin.sql.
-- IF NOT EXISTS: se puede relanzar si algo se corta.

CREATE TABLE IF NOT EXISTS admin_users (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  disabled      TINYINT      NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash    CHAR(64)     NOT NULL,
  admin_id      BIGINT       NOT NULL,
  csrf_token    VARCHAR(64)  NOT NULL,
  expires_at    BIGINT       NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  CONSTRAINT fk_admin_session FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  admin_id      BIGINT       NULL,
  action        VARCHAR(48)  NOT NULL,
  target        VARCHAR(128) NULL,
  detail        TEXT         NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_admin_audit_admin FOREIGN KEY (admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_items (
  id            VARCHAR(32)  NOT NULL,
  category      VARCHAR(16)  NOT NULL,
  asset_index   INT          NOT NULL,
  name          VARCHAR(64)  NOT NULL,
  description   VARCHAR(255) NULL,
  file          VARCHAR(255) NOT NULL,
  full_file     VARCHAR(255) NULL,
  color         VARCHAR(16)  NULL,
  width         DOUBLE       NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_custom_slot (category, asset_index),
  CONSTRAINT ck_custom_category CHECK (category IN ('board','wing','hat'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_overrides (
  item_id       VARCHAR(32)  NOT NULL,
  price_normal  BIGINT       NULL,
  rarity        VARCHAR(16)  NULL,
  name          VARCHAR(64)  NULL,
  description   VARCHAR(255) NULL,
  for_sale      TINYINT      NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (item_id),
  CONSTRAINT ck_override_price CHECK (price_normal IS NULL OR price_normal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS economy_overrides (
  `key`         VARCHAR(32)  NOT NULL,
  value_json    TEXT         NOT NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`),
  CONSTRAINT ck_economy_key CHECK (`key` IN ('exchangePackages','goldProducts','rewards'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
