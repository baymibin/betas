-- Surf Salvaje · 005 · Registro de seguridad de la cuenta (ver la versión SQLite). Solo tabla nueva.
CREATE TABLE IF NOT EXISTS security_events (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  event         VARCHAR(48)  NOT NULL,
  outcome       VARCHAR(4)   NOT NULL,
  user_id       VARCHAR(36)  NULL,
  ip            VARCHAR(64)  NULL,
  user_agent    VARCHAR(200) NULL,
  detail        TEXT         NULL,
  PRIMARY KEY (id),
  KEY security_events_user (user_id, id),
  KEY security_events_event (event, id),
  KEY security_events_ip (ip, id),
  CONSTRAINT ck_security_outcome CHECK (outcome IN ('ok','fail'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
