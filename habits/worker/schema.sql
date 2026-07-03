-- D1 schema for scheduled push notifications.
-- Run: wrangler d1 execute habits-push --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS scheduled_pushes (
  device_id    TEXT NOT NULL,
  sig          TEXT NOT NULL,
  fire_at      INTEGER NOT NULL,
  subscription TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  tag          TEXT NOT NULL,
  PRIMARY KEY (device_id, sig)
);

CREATE INDEX IF NOT EXISTS idx_fire_at ON scheduled_pushes(fire_at);
