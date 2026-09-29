-- Surf Salvaje · 005 · Registro de seguridad de la cuenta: inicios de sesión (correctos y
-- fallidos), registros, vinculaciones, cierres de sesión, compras, cambios de moneda y pagos.
-- Solo tabla nueva. Lo escribe src/audit.js; lo lee el panel /admin → Seguridad.
CREATE TABLE security_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  event         TEXT NOT NULL,                   -- p. ej. auth.login, shop.purchase
  outcome       TEXT NOT NULL CHECK (outcome IN ('ok','fail')),
  user_id       TEXT,                            -- sin FK: el registro sobrevive a la cuenta
  ip            TEXT,
  user_agent    TEXT,
  detail        TEXT                             -- JSON corto (proveedor, item, código de error...)
);
CREATE INDEX security_events_user ON security_events(user_id, id);
CREATE INDEX security_events_event ON security_events(event, id);
CREATE INDEX security_events_ip ON security_events(ip, id);
