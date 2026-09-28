-- Surf Salvaje · 004 · Panel administrativo: cuentas de administrador (usuario + contraseña),
-- sus sesiones, registro de acciones y catálogo editable (items subidos y cambios de precio,
-- rareza, textos y venta). Solo tablas nuevas.

CREATE TABLE admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                   -- scrypt$N$r$p$sal$hash
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

-- La cookie del panel guarda un token aleatorio; aquí solo su SHA-256.
CREATE TABLE admin_sessions (
  token_hash    TEXT PRIMARY KEY,
  admin_id      INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token    TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,                -- epoch ms
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Cada acción del panel deja una fila (quién, qué, sobre qué y detalle).
CREATE TABLE admin_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id      INTEGER REFERENCES admin_users(id),
  action        TEXT NOT NULL,
  target        TEXT,
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX admin_audit_created ON admin_audit(id DESC);

-- Tablas, wings y hats subidos desde el panel. Se añaden AL FINAL del catálogo compartido
-- (asset_index = siguiente libre): los índices existentes nunca cambian.
CREATE TABLE custom_items (
  id            TEXT PRIMARY KEY,                -- "wing:9"
  category      TEXT NOT NULL CHECK (category IN ('board','wing','hat')),
  asset_index   INTEGER NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  file          TEXT NOT NULL,                   -- /uploads/...
  full_file     TEXT,
  color         TEXT,
  width         REAL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (category, asset_index)
);

-- Cambios del panel sobre cualquier item (base o subido). NULL = sin cambio (manda economy.json).
CREATE TABLE item_overrides (
  item_id       TEXT PRIMARY KEY,
  price_normal  INTEGER CHECK (price_normal IS NULL OR price_normal >= 0),
  rarity        TEXT,
  name          TEXT,
  description   TEXT,
  for_sale      INTEGER,                         -- 0 = no se vende (quien ya lo tiene lo conserva)
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Paquetes de monedas, productos de oro y recompensas editados desde el panel (JSON que
-- sustituye a la sección del mismo nombre de economy.json).
CREATE TABLE economy_overrides (
  key           TEXT PRIMARY KEY CHECK (key IN ('exchangePackages','goldProducts','rewards')),
  value_json    TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
