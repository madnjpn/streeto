-- Replying to a comment, replying to a chat message, and reactions.
-- 025_chat_and_comment_extras.sql

-- A reply to a comment hangs under the comment it answers.
ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id, created_at);

-- A reply to a chat message points at the message it answers.
ALTER TABLE messages ADD COLUMN parent_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);

-- A document sent in a chat keeps its name and size here; the file
-- itself lives in media_path next to photos and videos.
ALTER TABLE messages ADD COLUMN file_name TEXT;
ALTER TABLE messages ADD COLUMN file_size INTEGER;

-- A reaction on a chat message. One of each emoji per driver.
CREATE TABLE IF NOT EXISTS message_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_message_reactions ON message_reactions(message_id);
