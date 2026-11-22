-- LogicLab database, first version: accounts, projects, AI usage and login throttling.
CREATE TABLE IF NOT EXISTS users (
  id      TEXT PRIMARY KEY,
  email   TEXT UNIQUE NOT NULL,
  name    TEXT NOT NULL,
  pass    TEXT NOT NULL,          -- "<salt b64>:<PBKDF2-SHA256 hash b64>"
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  uid     TEXT NOT NULL,
  id      TEXT NOT NULL,
  name    TEXT NOT NULL,
  type    TEXT,
  count   INTEGER DEFAULT 0,
  doc     TEXT NOT NULL,          -- project JSON
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (uid, id)
);
CREATE INDEX IF NOT EXISTS projects_uid_updated ON projects (uid, updated DESC);
CREATE TABLE IF NOT EXISTS usage (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, day)
);
CREATE TABLE IF NOT EXISTS attempts (  -- login throttle
  k  TEXT PRIMARY KEY,
  n  INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
