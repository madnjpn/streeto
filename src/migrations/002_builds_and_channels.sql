-- ────────────────────────────────────────────────────────────────
--  Migration 002 - builds, build voting and chat channels
--
--  Adds the "builds" feature (members upload their cars with photos,
--  clips and a spec sheet, and vote for build of the week) plus a
--  single open "global" chat channel alongside the existing 1-to-1
--  direct messages.
-- ────────────────────────────────────────────────────────────────

-- ── builds ──────────────────────────────────────────────────────
-- visibility: public  -> anyone can see it
--             private -> only the owner can see it
CREATE TABLE builds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  make        TEXT,
  model       TEXT,
  year        INTEGER,
  engine      TEXT,
  drivetrain  TEXT,
  transmission TEXT,
  power_hp    INTEGER,
  torque_nm   INTEGER,
  weight_kg   INTEGER,
  mods        TEXT,
  description TEXT,
  visibility  TEXT    NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  cover       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_builds_user ON builds (user_id, created_at DESC);
CREATE INDEX idx_builds_visibility ON builds (visibility, created_at DESC);

CREATE TABLE build_media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id   INTEGER NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_type TEXT    NOT NULL CHECK (media_type IN ('photo','video')),
  media_path TEXT    NOT NULL,
  caption    TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_build_media_build ON build_media (build_id, position, id);

-- One vote per member per ISO week. The unique key is what makes the
-- weekly contest fair: a driver picks a single build to back each week.
CREATE TABLE build_votes (
  build_id   INTEGER NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, week)
);
CREATE INDEX idx_build_votes_build ON build_votes (build_id, week);

-- Awards are derived from the vote history: the most-voted build of a
-- closed week becomes Build of the Week, four weekly wins inside one
-- calendar month upgrade it to Build of the Month, and a build whose
-- yearly win count beats the field's average takes Build of the Year.
CREATE TABLE build_awards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id   INTEGER NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('week','month','year')),
  period     TEXT    NOT NULL,
  votes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (kind, period)
);
CREATE INDEX idx_build_awards_build ON build_awards (build_id, kind);

-- ── chat channels ───────────────────────────────────────────────
-- kind: dm     -> a 1-to-1 conversation between two members
--       global -> the one open channel everybody shares
ALTER TABLE conversations ADD COLUMN kind  TEXT NOT NULL DEFAULT 'dm';
ALTER TABLE conversations ADD COLUMN name  TEXT;
ALTER TABLE conversations ADD COLUMN topic TEXT;

-- Only one global channel may ever exist.
CREATE UNIQUE INDEX idx_conversations_global ON conversations (kind) WHERE kind = 'global';

-- Create the global channel and put every existing member in it.
INSERT INTO conversations (created_by, kind, name, topic)
SELECT NULL, 'global', 'Global', 'The open pit lane. Talk to every driver on the network.'
 WHERE NOT EXISTS (SELECT 1 FROM conversations WHERE kind = 'global');

INSERT OR IGNORE INTO conversation_members (conversation_id, user_id)
SELECT c.id, u.id
  FROM conversations c
  JOIN users u
 WHERE c.kind = 'global';
