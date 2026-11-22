-- Serialize AI provider calls across all users and Cloudflare Worker instances.
CREATE TABLE ai_queue (
  ticket INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ai_queue_order ON ai_queue (ticket, status, lease_until);
