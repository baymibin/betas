-- Surf Salvaje · 003 · Trades públicos (tablón): "ofrezco estos items, busco estos otros".
-- Quien ve una publicación negocia con su dueño enviándole una oferta normal (trade_offers)
-- enlazada a la publicación. No se modifica ni se borra ninguna tabla anterior.

CREATE TABLE trade_listings (
  id            TEXT PRIMARY KEY,                -- UUID
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETED','CANCELED','EXPIRED','INVALID')),
  request_id    TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,                -- epoch ms
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, request_id)
);
CREATE INDEX trade_listings_status ON trade_listings(status, created_at);
CREATE INDEX trade_listings_user ON trade_listings(user_id, status);

-- OFFER = lo que publica su dueño · WANT = lo que busca a cambio (opcional)
CREATE TABLE trade_listing_items (
  listing_id    TEXT NOT NULL REFERENCES trade_listings(id) ON DELETE CASCADE,
  side          TEXT NOT NULL CHECK (side IN ('OFFER','WANT')),
  item_id       TEXT NOT NULL REFERENCES shop_items(id),
  PRIMARY KEY (listing_id, item_id)
);
CREATE INDEX trade_listing_items_item ON trade_listing_items(item_id);

-- Ofertas que nacen de una publicación.
CREATE TABLE trade_listing_offers (
  offer_id      TEXT PRIMARY KEY REFERENCES trade_offers(id) ON DELETE CASCADE,
  listing_id    TEXT NOT NULL REFERENCES trade_listings(id) ON DELETE CASCADE
);
CREATE INDEX trade_listing_offers_listing ON trade_listing_offers(listing_id);
