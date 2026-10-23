-- 029_comment_reactions.sql
-- A reaction on a comment: one of each emoji per driver, the same way
-- the chat messages work.
CREATE TABLE IF NOT EXISTS comment_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (comment_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_comment_reactions ON comment_reactions(comment_id);
