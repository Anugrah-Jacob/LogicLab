-- Per-user AI limits: 8 requests per minute and 60 requests per day.
CREATE TABLE IF NOT EXISTS ai_minute_usage (
  uid TEXT NOT NULL,
  minute_key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, minute_key)
);
