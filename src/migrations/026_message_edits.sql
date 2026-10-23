-- 026_message_edits.sql
-- A message can be edited by the person who wrote it. The time of the
-- last edit is kept so the thread can show that it was changed.
ALTER TABLE messages ADD COLUMN edited_at TEXT;
