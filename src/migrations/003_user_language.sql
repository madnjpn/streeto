-- Per-user interface language ('en' English, 'ka' Georgian).
-- NULL means "not chosen yet" - the cookie / Accept-Language decides.
ALTER TABLE users ADD COLUMN language TEXT;
