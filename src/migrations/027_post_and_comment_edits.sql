-- 027_post_and_comment_edits.sql
-- A post or a comment can be edited by the person who wrote it. The time
-- of the last edit is kept so the page can show that it was changed.
ALTER TABLE posts ADD COLUMN edited_at TEXT;
ALTER TABLE comments ADD COLUMN edited_at TEXT;
