-- Underground nights: closed/invite-only races with host approval.
CREATE TABLE IF NOT EXISTS underground_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT    NOT NULL,
  description     TEXT,
  type            TEXT    NOT NULL CHECK (type IN ('drag','drift','touge')),
  starts_at       TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','finished','cancelled')),
  meet_name       TEXT,
  meet_lat        REAL    NOT NULL,
  meet_lng        REAL    NOT NULL,
  zoom            INTEGER,
  route_start_lat REAL,
  route_start_lng REAL,
  route_start_name TEXT,
  route_end_lat   REAL,
  route_end_lng   REAL,
  route_end_name TEXT,
  route_distance_km REAL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_underground_events_time ON underground_events (status, starts_at);

CREATE TABLE IF NOT EXISTS underground_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL REFERENCES underground_events(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  car_model   TEXT,
  car_photo   TEXT,
  status      TEXT    NOT NULL DEFAULT 'requested'
              CHECK (status IN ('requested','approved','rejected')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at  TEXT,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_underground_requests_event ON underground_requests (event_id, status);
CREATE INDEX IF NOT EXISTS idx_underground_requests_user ON underground_requests (user_id, status);

CREATE TABLE IF NOT EXISTS underground_runs (
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
  summary_sent_at TEXT,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_underground_runs_user ON underground_runs (user_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_underground_runs_event ON underground_runs (event_id);

CREATE TABLE IF NOT EXISTS underground_positions (
  event_id   INTEGER NOT NULL REFERENCES underground_events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat        REAL    NOT NULL,
  lng        REAL    NOT NULL,
  speed      REAL,
  heading    REAL,
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_underground_positions_event ON underground_positions (event_id);
