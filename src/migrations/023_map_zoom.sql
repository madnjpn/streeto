-- The zoom level of the map at the moment the spot was picked. The saved
-- map opens at the same zoom, so the pin keeps the view it was framed in.
ALTER TABLE posts ADD COLUMN zoom REAL;
ALTER TABLE meetups ADD COLUMN zoom REAL;
ALTER TABLE services ADD COLUMN zoom REAL;
