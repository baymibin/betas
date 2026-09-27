-- Surf Salvaje · 001 · Cuentas, identidades, sesiones y economía base.
-- SQL estándar (SQLite) pensado para poder portarse a MySQL/PostgreSQL sin cambios de modelo.
-- Todas las cantidades de monedas son INTEGER (nunca coma flotante) y no pueden ser negativas.

-- Cuenta interna de Surf Salvaje (surf_user_id). Es la única identidad económica:
-- Google y Discord solo son formas de entrar a ella.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,                -- surf_user_id (UUID)
  nickname      TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  local_migrated INTEGER NOT NULL DEFAULT 0      -- 1 = ya se importó el equipamiento del navegador
);

-- Identidades externas vinculadas. (provider, subject) es único: una identidad de Google o
-- Discord pertenece como mucho a una cuenta. El correo NO se usa como identificador.
CREATE TABLE auth_identities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google','discord')),
  subject       TEXT NOT NULL,                   -- "sub" de Google / id de Discord (estables)
  display_name  TEXT,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT,
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)                     -- una identidad de cada proveedor por cuenta
);

-- Sesiones del navegador: la cookie guarda un token aleatorio; aquí solo su hash SHA-256.
CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    INTEGER NOT NULL                 -- epoch ms
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Flujos OAuth en curso (state de un solo uso, PKCE, nonce). Caducan a los 10 minutos.
CREATE TABLE oauth_states (
  state_hash    TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('login','link')),
  link_user_id  TEXT REFERENCES users(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  browser_hash  TEXT NOT NULL,                   -- liga el flujo a la cookie del navegador que lo inició
  expires_at    INTEGER NOT NULL
);

CREATE TABLE user_settings (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Monedero: exactamente dos monedas con saldos independientes.
CREATE TABLE wallets (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency      TEXT NOT NULL CHECK (currency IN ('NORMAL_COIN','GOLD_COIN')),
  balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, currency)
);

-- Libro de movimientos: cada cambio de saldo deja una fila con el saldo resultante.
-- (user_id, currency, type, reference) es único: la misma operación no puede aplicarse dos veces.
CREATE TABLE wallet_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency      TEXT NOT NULL CHECK (currency IN ('NORMAL_COIN','GOLD_COIN')),
  amount        INTEGER NOT NULL CHECK (amount <> 0),       -- positivo = ingreso, negativo = gasto
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  type          TEXT NOT NULL CHECK (type IN ('RACE_REWARD','ITEM_PURCHASE','GOLD_EXCHANGE','GOLD_CREDIT','GOLD_REFUND','ADMIN_ADJUSTMENT')),
  reference     TEXT NOT NULL,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, currency, type, reference)
);
CREATE INDEX wallet_transactions_user ON wallet_transactions(user_id, id DESC);

-- Catálogo de La tiendita. El id conserva el índice que usa Babylon.js ("wing:2" = wingFiles[2]).
CREATE TABLE shop_items (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL CHECK (category IN ('character','board','wing','hat')),
  asset_index   INTEGER NOT NULL CHECK (asset_index >= 0),
  name          TEXT NOT NULL,
  description   TEXT,
  asset         TEXT,
  price_normal  INTEGER NOT NULL DEFAULT 0 CHECK (price_normal >= 0),   -- 0 = gratis para todos
  available     INTEGER NOT NULL DEFAULT 1,
  unique_owner  INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category, asset_index)
);

-- Inventario permanente (solo artículos de pago o regalados; los gratuitos no hace falta poseerlos).
CREATE TABLE user_inventory (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  source        TEXT NOT NULL CHECK (source IN ('PURCHASE','GIFT','MIGRATION','ADMIN')),
  reference     TEXT,
  acquired_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, item_id)
);

-- Equipamiento: un artículo por ranura.
CREATE TABLE equipped_items (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot          TEXT NOT NULL CHECK (slot IN ('character','board','wing','hat')),
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, slot)
);

-- Compras de artículos (idempotentes por request_id del cliente).
CREATE TABLE item_purchases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  price_normal  INTEGER NOT NULL CHECK (price_normal >= 0),
  request_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, request_id),
  UNIQUE (user_id, item_id)
);

-- Paquetes de conversión Oro -> Normales. gold_price NULL = aún sin precio configurado (inactivo).
CREATE TABLE coin_exchange_packages (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  normal_amount INTEGER NOT NULL CHECK (normal_amount > 0),
  gold_price    INTEGER CHECK (gold_price IS NULL OR gold_price > 0),
  active        INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE coin_exchange_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id    TEXT NOT NULL REFERENCES coin_exchange_packages(id),
  gold_spent    INTEGER NOT NULL CHECK (gold_spent > 0),
  normal_received INTEGER NOT NULL CHECK (normal_received > 0),
  request_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, request_id)
);

-- Pagos reales (preparado; deshabilitado hasta integrar un proveedor verificado).
CREATE TABLE payment_products (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  gold_amount   INTEGER NOT NULL CHECK (gold_amount > 0),
  price_minor   INTEGER CHECK (price_minor IS NULL OR price_minor > 0),   -- céntimos; NULL = sin precio
  price_currency TEXT,
  active        INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE payment_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  product_id    TEXT NOT NULL REFERENCES payment_products(id),
  provider      TEXT NOT NULL,
  provider_ref  TEXT,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
  currency      TEXT NOT NULL,
  gold_amount   INTEGER NOT NULL CHECK (gold_amount > 0),
  status        TEXT NOT NULL CHECK (status IN ('CREATED','PENDING','PAID','CREDITED','FAILED','CANCELED','REFUNDED','CHARGEBACK')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_ref)
);

CREATE TABLE payment_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  order_id      TEXT REFERENCES payment_orders(id),
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, event_id)
);

-- Recompensas de carrera ya entregadas (una por cuenta y carrera).
CREATE TABLE race_rewards (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id       TEXT NOT NULL,
  place         INTEGER NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  day           TEXT NOT NULL,                    -- AAAA-MM-DD (UTC) para el tope diario
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, race_id)
);
CREATE INDEX race_rewards_day ON race_rewards(user_id, day);
