-- Partners / sponsors: admin-uploaded logos shown on a public Partners page.
-- Orderable so featured partners can be placed first.
CREATE TABLE IF NOT EXISTS partners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  logo_path   TEXT    NOT NULL,
  url         TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_partners_active ON partners (is_active, position);