-- Service claims: a real service provider can claim an existing listing
-- (created by someone else) and, once an admin approves, take ownership.
ALTER TABLE services ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS service_claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  claimant_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  message     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  UNIQUE (service_id, claimant_id)
);

CREATE INDEX IF NOT EXISTS idx_service_claims_status ON service_claims (status, created_at);
CREATE INDEX IF NOT EXISTS idx_services_verified ON services (verified);