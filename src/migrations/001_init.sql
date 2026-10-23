-- ────────────────────────────────────────────────────────────────
--  Migration 001 - initial schema for STREETO
--  Timestamps are stored as ISO-8601 UTC strings with milliseconds
--  (strftime('%Y-%m-%dT%H:%M:%fZ','now')) so they can be handed to
--  JavaScript's Date constructor with no parsing tricks.
-- ────────────────────────────────────────────────────────────────

-- ── people ──────────────────────────────────────────────────────
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT,
  avatar        TEXT,
  bio           TEXT,
  car           TEXT,
  city          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_users_username ON users (username COLLATE NOCASE);

-- ── sessions (express-session store) ────────────────────────────
CREATE TABLE sessions (
  sid     TEXT    PRIMARY KEY,
  data    TEXT    NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions (expires);

-- ── groups ──────────────────────────────────────────────────────
-- privacy: open     -> anyone may join instantly
--          private  -> anyone may request, owner/admin approves
--          invite   -> hidden; only invited people can join
CREATE TABLE groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  description TEXT,
  privacy     TEXT    NOT NULL DEFAULT 'open' CHECK (privacy IN ('open','private','invite')),
  avatar      TEXT,
  owner_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_groups_privacy ON groups (privacy);

-- role:   owner | admin | member
-- status: active | pending | invited
CREATE TABLE group_members (
  group_id   INTEGER NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','invited')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members (user_id, status);

-- ── the wall ────────────────────────────────────────────────────
-- post_type: text | photo | video | location | emergency
-- group_id NULL -> public wall post, otherwise a group post
CREATE TABLE posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id    INTEGER REFERENCES groups (id) ON DELETE CASCADE,
  body        TEXT,
  post_type   TEXT    NOT NULL DEFAULT 'text'
              CHECK (post_type IN ('text','photo','video','location','emergency')),
  media_type  TEXT    CHECK (media_type IS NULL OR media_type IN ('photo','video')),
  media_path  TEXT,
  place_name  TEXT,
  address     TEXT,
  lat         REAL,
  lng         REAL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_posts_created ON posts (created_at DESC);
CREATE INDEX idx_posts_user ON posts (user_id, created_at DESC);
CREATE INDEX idx_posts_group ON posts (group_id, created_at DESC);

CREATE TABLE post_likes (
  post_id    INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_post_likes_user ON post_likes (user_id);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_comments_post ON comments (post_id, created_at);

-- ── friendships ─────────────────────────────────────────────────
-- status: pending | accepted | declined | blocked
CREATE TABLE friendships (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','declined','blocked')),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX idx_friendships_requester ON friendships (requester_id, status);
CREATE INDEX idx_friendships_addressee ON friendships (addressee_id, status);

-- ── direct chat ─────────────────────────────────────────────────
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- cleared_at lets one member hide/delete a chat without touching the
-- other person's history. last_read_id powers unread counters.
CREATE TABLE conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_id    INTEGER NOT NULL DEFAULT 0,
  cleared_at      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_conv_members_user ON conversation_members (user_id);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body            TEXT,
  media_type      TEXT    CHECK (media_type IS NULL OR media_type IN ('photo','video')),
  media_path      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_conv ON messages (conversation_id, id);

-- ── meetups ─────────────────────────────────────────────────────
-- privacy: open | private (approval required) | invite (hidden)
CREATE TABLE meetups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id    INTEGER REFERENCES groups (id) ON DELETE SET NULL,
  title       TEXT    NOT NULL,
  description TEXT,
  place_name  TEXT,
  address     TEXT,
  lat         REAL,
  lng         REAL,
  starts_at   TEXT    NOT NULL,
  privacy     TEXT    NOT NULL DEFAULT 'open' CHECK (privacy IN ('open','private','invite')),
  capacity    INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_meetups_starts ON meetups (starts_at);
CREATE INDEX idx_meetups_host ON meetups (host_id);

-- status: going | maybe | requested | invited | declined
CREATE TABLE meetup_attendees (
  meetup_id  INTEGER NOT NULL REFERENCES meetups (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status     TEXT    NOT NULL DEFAULT 'going'
             CHECK (status IN ('going','maybe','requested','invited','declined')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (meetup_id, user_id)
);
CREATE INDEX idx_meetup_attendees_user ON meetup_attendees (user_id);

-- ── notifications ───────────────────────────────────────────────
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  entity_id  INTEGER,
  url        TEXT,
  text       TEXT    NOT NULL,
  read_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read_at);
