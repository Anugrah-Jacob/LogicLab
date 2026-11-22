-- Live collaboration: share links, version history and WebRTC signalling (peer discovery only).
-- Circuit data never flows through these tables while people are connected; it goes browser to browser.
CREATE TABLE IF NOT EXISTS shares (
  id       TEXT PRIMARY KEY,            -- public room id used in the share link
  uid      TEXT NOT NULL,               -- owner
  pid      TEXT NOT NULL,               -- project id
  view_key TEXT NOT NULL,               -- AES-GCM sealed, so the owner can read the links again
  edit_key TEXT NOT NULL,
  view_on  INTEGER NOT NULL DEFAULT 1,
  edit_on  INTEGER NOT NULL DEFAULT 1,
  created  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shares_project ON shares (uid, pid);
CREATE TABLE IF NOT EXISTS peers (      -- who is in a room right now (heartbeat every ~15 s)
  room TEXT NOT NULL,
  peer TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,                   -- owner | edit | view
  slot INTEGER NOT NULL,                -- 0..11, gives each person their own range of part ids
  seen INTEGER NOT NULL,
  PRIMARY KEY (room, peer)
);
CREATE UNIQUE INDEX IF NOT EXISTS peers_slot ON peers (room, slot);
CREATE TABLE IF NOT EXISTS signals (    -- short-lived WebRTC handshake messages
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  src  TEXT NOT NULL,
  dst  TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  ts   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_dst ON signals (room, dst, id);
CREATE TABLE IF NOT EXISTS history (    -- saved versions of a project (doc is a marker when the body lives in MongoDB)
  id      TEXT PRIMARY KEY,
  uid     TEXT NOT NULL,
  pid     TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  by_name TEXT NOT NULL DEFAULT '',
  label   TEXT NOT NULL DEFAULT '',
  bytes   INTEGER NOT NULL DEFAULT 0,
  hash    TEXT NOT NULL DEFAULT '',
  doc     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_project ON history (uid, pid, ts DESC);
