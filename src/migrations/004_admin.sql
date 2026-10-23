-- ────────────────────────────────────────────────────────────────
--  Migration 004 - admin role
--
--  Adds an `is_admin` flag to users. Admins can promote other
--  drivers, hand the role over, and moderate (delete) any user, post
--  or meetup from the admin console.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_users_admin ON users (is_admin);
