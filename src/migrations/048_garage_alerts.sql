-- Garage alerts: remember the result of the last fines sweep and which
-- fines have already been announced, plus the last PTI alert sent for a car.
ALTER TABLE vehicles ADD COLUMN fines_checked_at TEXT;
ALTER TABLE vehicles ADD COLUMN fines_count INTEGER;
ALTER TABLE vehicles ADD COLUMN fines_amount INTEGER;
ALTER TABLE vehicles ADD COLUMN fines_reminded_at TEXT;
ALTER TABLE vehicles ADD COLUMN pti_alert_key TEXT;
ALTER TABLE vehicles ADD COLUMN pti_reminded_at TEXT;

ALTER TABLE builds ADD COLUMN pti_alert_key TEXT;
ALTER TABLE builds ADD COLUMN pti_reminded_at TEXT;

CREATE TABLE IF NOT EXISTS vehicle_fines (
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fine_key     TEXT NOT NULL,
  protocol_no  TEXT,
  amount       INTEGER,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (vehicle_id, fine_key)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fines_vehicle ON vehicle_fines(vehicle_id);
