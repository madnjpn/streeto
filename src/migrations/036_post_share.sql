-- Add share columns to posts for sharing builds, parts, services, etc.
ALTER TABLE posts ADD COLUMN share_type TEXT;
ALTER TABLE posts ADD COLUMN share_id INTEGER;
ALTER TABLE posts ADD COLUMN share_title TEXT;
ALTER TABLE posts ADD COLUMN share_text TEXT;
ALTER TABLE posts ADD COLUMN share_image TEXT;
ALTER TABLE posts ADD COLUMN share_url TEXT;