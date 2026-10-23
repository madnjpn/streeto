-- When a member was last seen on the site. Used for the online dot next
-- to friends, so it only has to be roughly right.
ALTER TABLE users ADD COLUMN last_seen TEXT;
