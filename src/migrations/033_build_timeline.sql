-- The build timeline: what was done to the car, and when.
--
-- The "mods" field on a build is a summary in the owner's own words.
-- The timeline is the history behind it: every change with its date, the
-- reading of the odometer at the time, what it cost and a picture.
CREATE TABLE IF NOT EXISTS build_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT,
  description TEXT,
  mileage INTEGER,
  cost REAL,
  photo TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_build_timeline_build ON build_timeline (build_id, changed_at DESC);
