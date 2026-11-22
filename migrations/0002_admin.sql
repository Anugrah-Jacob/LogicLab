-- Admin panel: roles, disabled accounts, per-user AI limits, template tracking and platform settings.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login INTEGER;
ALTER TABLE users ADD COLUMN ai_limit INTEGER;          -- NULL = use the platform default
ALTER TABLE projects ADD COLUMN tpl TEXT;               -- example/template id the project started from
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_created ON users (created);
