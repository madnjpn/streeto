-- 006_features.sql
-- Hashtags, polls, reports, push subscriptions, meetup categories.

CREATE TABLE IF NOT EXISTS post_tags (
  post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag      TEXT    NOT NULL,
  created_at TEXT  NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);

CREATE TABLE IF NOT EXISTS polls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  question   TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS poll_options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id);

CREATE TABLE IF NOT EXISTS poll_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (poll_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type  TEXT    NOT NULL,  -- 'post' | 'user' | 'crew' | 'build' | 'meetup' | 'comment'
  target_id    INTEGER NOT NULL,
  reason       TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'open',  -- 'open' | 'resolved' | 'dismissed'
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_by  INTEGER REFERENCES users(id),
  resolved_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT    NOT NULL UNIQUE,
  p256dh      TEXT    NOT NULL,
  auth        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Meetup categories + entry fee
ALTER TABLE meetups ADD COLUMN category TEXT NOT NULL DEFAULT 'meetup';
ALTER TABLE meetups ADD COLUMN entry_fee TEXT;