-- Deleting an Underground night archives it instead of destroying the
-- saved runs. The meetup disappears from the network, but every driver's
-- My Underground statistics stay available.
ALTER TABLE underground_events ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_underground_events_live
  ON underground_events (deleted_at, status, starts_at);
