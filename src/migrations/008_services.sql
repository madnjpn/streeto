-- ────────────────────────────────────────────────────────────────
--  Migration 008 - the Services tab
--
--  Two features under one roof:
--    * parts      - a buy & sell board for car parts (photos, price,
--                   phone, location, category)
--    * services   - a directory of workshops and specialists (map pin,
--                   contact details, category), with star ratings and
--                   written reviews from other drivers.
--
--  Plus a flag on members so a shop or specialist can mark themselves
--  as a service provider for everyone to see.
-- ────────────────────────────────────────────────────────────────

-- ── service provider flag on members ────────────────────────────
-- is_provider: 1 when the member offers car services (shop, mechanic,
-- tuner, detailer ...). provider_name is their trading name, if any.
ALTER TABLE users ADD COLUMN is_provider   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN provider_name TEXT;

-- ── parts marketplace ───────────────────────────────────────────
-- price is stored as whole units (GEL). It is NULL when the seller
-- would rather talk (see price_note: "negotiable", "swap", "per pair").
-- status flips to 'sold' so old ads stay visible but stop looking live.
CREATE TABLE IF NOT EXISTS parts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'other',
  price       INTEGER,
  price_note  TEXT,
  description TEXT,
  phone       TEXT,
  location    TEXT,
  status      TEXT    NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold')),
  cover       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_parts_created  ON parts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_user     ON parts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts (category, created_at DESC);

CREATE TABLE IF NOT EXISTS part_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id    INTEGER NOT NULL REFERENCES parts (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_path TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_part_photos_part ON part_photos (part_id, position, id);

-- ── maintenance / service providers ─────────────────────────────
-- One row per listing. A member can post several (e.g. two shops).
CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'other',
  description TEXT,
  phone       TEXT,
  email       TEXT,
  place_name  TEXT,
  address     TEXT,
  lat         REAL,
  lng         REAL,
  cover       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_services_created  ON services (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_user     ON services (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_category ON services (category, created_at DESC);

-- One review per driver per listing: re-posting updates the old one,
-- which keeps the average honest and stops vote-stuffing.
CREATE TABLE IF NOT EXISTS service_reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (service_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_service_reviews_service ON service_reviews (service_id, updated_at DESC);
