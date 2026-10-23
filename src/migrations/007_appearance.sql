-- Global appearance settings (font choice) and uploaded custom fonts.
-- These live in the database, not a session, so the choice applies to
-- every visitor and survives restarts.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS custom_fonts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mimetype      TEXT NOT NULL,
  format        TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  family        TEXT NOT NULL,
  weight        TEXT NOT NULL DEFAULT '400',
  style         TEXT NOT NULL DEFAULT 'normal',
  lang          TEXT NOT NULL DEFAULT 'all',
  usage         TEXT NOT NULL DEFAULT 'both',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
