-- Per-category push preferences. The activity feed is always kept; this
-- only decides which categories may send a phone/browser notification.
ALTER TABLE users ADD COLUMN notify_prefs TEXT;
