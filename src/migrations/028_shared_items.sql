-- 028_shared_items.sql
-- A message can carry a shared thing: a build, a post, a meetup, a part
-- or a service. The wording and the picture are a snapshot, so the card
-- still reads well even when the thing itself is gone.
ALTER TABLE messages ADD COLUMN share_type TEXT;
ALTER TABLE messages ADD COLUMN share_id INTEGER;
ALTER TABLE messages ADD COLUMN share_title TEXT;
ALTER TABLE messages ADD COLUMN share_text TEXT;
ALTER TABLE messages ADD COLUMN share_image TEXT;
