-- Background media work. Uploads return immediately; the worker turns
-- videos into browser-safe MP4 files and makes the poster.
CREATE TABLE IF NOT EXISTS media_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL DEFAULT 'video',
  source_path TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','processing','done','failed','skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_jobs_queue ON media_jobs (status, id);
CREATE INDEX IF NOT EXISTS idx_media_jobs_source ON media_jobs (source_path);
