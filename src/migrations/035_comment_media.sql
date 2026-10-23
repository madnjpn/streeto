-- Add media support to comments
ALTER TABLE comments ADD COLUMN media_path TEXT;
ALTER TABLE comments ADD COLUMN media_type TEXT;