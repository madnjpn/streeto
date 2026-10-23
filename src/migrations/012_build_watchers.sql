-- Following a build: a driver taps "Notify me" on a car they would buy,
-- and gets an alert the moment the owner puts it up for sale. One row per
-- (build, driver); the row disappears if either side is deleted.
CREATE TABLE IF NOT EXISTS build_watchers (
  build_id   INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (build_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_build_watchers_user ON build_watchers (user_id);
