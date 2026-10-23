-- Partner logos: how the page has to show them.
--
-- logo_w / logo_h - the real size of the mark, so the wall can give it
-- the room it needs and the browser knows the shape before the picture
-- is in.
--
-- logo_plate - how the mark is shown:
-- 0 - the mark floats on transparency, it sits straight on the dark frame
-- 1 - the mark was drawn on white paper, it gets a light tile
-- 2 - the mark was drawn on black paper, it gets a dark tile
ALTER TABLE partners ADD COLUMN logo_w INTEGER;
ALTER TABLE partners ADD COLUMN logo_h INTEGER;
ALTER TABLE partners ADD COLUMN logo_plate INTEGER NOT NULL DEFAULT 0;
