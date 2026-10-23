-- Wall posts can be limited to the author's friends.
--   public  -> anyone on STREETO can see it
--   friends -> only the author and their accepted friends see it
-- Crew posts keep their own access rules (membership), so they stay
-- 'public' and are filtered by the crew instead.
ALTER TABLE posts ADD COLUMN privacy TEXT NOT NULL DEFAULT 'public';
CREATE INDEX idx_posts_privacy ON posts (privacy);
