-- Annual technical inspection (pti.ge) snapshot. The plate is stored with
-- the result so a later plate edit cannot show a stale status, and the
-- expiry date lets the badge turn red on its own when the inspection lapses.
ALTER TABLE vehicles ADD COLUMN pti_status TEXT;          -- valid | expired | unknown
ALTER TABLE vehicles ADD COLUMN pti_plate TEXT;           -- normalised plate the result belongs to
ALTER TABLE vehicles ADD COLUMN pti_inspected_at TEXT;    -- YYYY-MM-DD
ALTER TABLE vehicles ADD COLUMN pti_expires_at TEXT;      -- YYYY-MM-DD
ALTER TABLE vehicles ADD COLUMN pti_checked_at TEXT;      -- ISO timestamp of the lookup

ALTER TABLE builds ADD COLUMN pti_status TEXT;
ALTER TABLE builds ADD COLUMN pti_plate TEXT;
ALTER TABLE builds ADD COLUMN pti_inspected_at TEXT;
ALTER TABLE builds ADD COLUMN pti_expires_at TEXT;
ALTER TABLE builds ADD COLUMN pti_checked_at TEXT;
