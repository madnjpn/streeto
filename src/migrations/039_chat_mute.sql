-- Per-member chat mute. DMs and the global channel can both be muted;
-- muting suppresses push notifications and the nav unread badge, while the
-- thread itself stays available.
ALTER TABLE conversation_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
