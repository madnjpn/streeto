-- The letters the site sends on its own: the weekly digest and the
-- inspection reminders.
--
-- mail_log remembers what was already sent, so nobody gets the same
-- reminder twice.
ALTER TABLE users ADD COLUMN mail_digest INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN mail_pti INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_log_once ON mail_log (user_id, kind, ref);
