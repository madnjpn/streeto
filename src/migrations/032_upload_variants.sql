-- Smaller copies of a picture.
--
-- Every image is stored once, at the size it is shown at. These rows
-- point at the extra copies, so a phone can ask for the small one and a
-- big screen for the large one, instead of everybody downloading the
-- biggest file.
CREATE TABLE IF NOT EXISTS upload_variants (
  source TEXT NOT NULL,
  width  INTEGER NOT NULL,
  path   TEXT NOT NULL,
  PRIMARY KEY (source, width)
);
CREATE INDEX IF NOT EXISTS idx_upload_variants_source ON upload_variants (source);
