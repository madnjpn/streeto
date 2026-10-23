-- The Georgian dictionary, editable by admins at runtime. The rows are
-- seeded from src/lib/locales/ka.js on boot; the database is the truth
-- from then on, so a corrected translation survives a restart.
-- A row with deleted = 1 means "no translation for this key" - the
-- English text is shown instead and the seed will not resurrect it.
CREATE TABLE IF NOT EXISTS translations (
  lang    TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (lang, key)
);

-- The "How it works" page, editable by admins. The English text of a
-- heading or a block is the translation key, so deleting a block also
-- removes the Georgian translation that belonged to it.
CREATE TABLE IF NOT EXISTS how_sections (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  icon     TEXT NOT NULL DEFAULT 'bolt',
  heading  TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS how_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES how_sections(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'p',
  body       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS how_blocks_section ON how_blocks(section_id, position);
