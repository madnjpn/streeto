-- 030_password_resets.sql
-- One row per link that was asked for from the login screen.
--
-- Only the hash of the token is kept, the same way a password is kept:
-- whoever reads this table cannot use it to take an account over. A row
-- is good until expires_at, and dies the moment used_at is set.
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email      TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);
