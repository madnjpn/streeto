-- A driver can record more than one run at an Underground night. Keep every
-- run as its own summary instead of overwriting the previous one.
CREATE TABLE IF NOT EXISTS underground_runs_next (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES underground_events(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode         TEXT    NOT NULL CHECK (mode IN ('drag','drift','touge')),
  started_at   TEXT    NOT NULL,
  finished_at  TEXT    NOT NULL,
  top_speed    REAL    NOT NULL DEFAULT 0,
  avg_speed    REAL    NOT NULL DEFAULT 0,
  distance_km  REAL    NOT NULL DEFAULT 0,
  acceleration REAL,
  duration_s   INTEGER NOT NULL DEFAULT 0,
  track_json   TEXT    NOT NULL DEFAULT '[]',
  summary_sent_at TEXT
);

INSERT INTO underground_runs_next
  (id, event_id, user_id, mode, started_at, finished_at, top_speed, avg_speed,
   distance_km, acceleration, duration_s, track_json, summary_sent_at)
SELECT id, event_id, user_id, mode, started_at, finished_at, top_speed, avg_speed,
       distance_km, acceleration, duration_s, track_json, summary_sent_at
  FROM underground_runs;

DROP TABLE underground_runs;
ALTER TABLE underground_runs_next RENAME TO underground_runs;
CREATE INDEX IF NOT EXISTS idx_underground_runs_user ON underground_runs (user_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_underground_runs_event ON underground_runs (event_id);
CREATE INDEX IF NOT EXISTS idx_underground_runs_event_user ON underground_runs (event_id, user_id, finished_at DESC);
