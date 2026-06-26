-- 0008_notifications.sql
-- Notification center, delivery records, and notification rules

CREATE TABLE IF NOT EXISTS notification_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('expiry', 'cert_expiry', 'worker_stale', 'digest')),
  threshold_days  integer,   -- NULL for non-day-based rules (worker_stale, digest)
  enabled         boolean NOT NULL DEFAULT TRUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, threshold_days)
);

-- Seed default expiry rules (7d, 2d, 0d)
INSERT INTO notification_rules (kind, threshold_days, enabled)
VALUES
  ('expiry',      7, TRUE),
  ('expiry',      2, TRUE),
  ('expiry',      0, TRUE),
  ('cert_expiry', 7, TRUE),
  ('cert_expiry', 2, TRUE),
  ('cert_expiry', 0, TRUE),
  ('worker_stale', NULL, TRUE),
  ('digest',      NULL, TRUE)
ON CONFLICT (kind, threshold_days) DO NOTHING;

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('expiry', 'cert_expiry', 'worker_stale', 'system')),
  severity    text NOT NULL CHECK (severity IN ('info', 'warning', 'danger')),
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  target_type text CHECK (target_type IN ('secret', 'server', 'cert')),
  target_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_read_at_idx    ON notifications (read_at) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('in_app', 'email')),
  recipient       text,      -- email address for email channel
  status          text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_deliveries_notif_idx ON notification_deliveries (notification_id);

-- De-duplication table: tracks which (secret_id/cert_id, rule_id) pairs have fired
-- Re-armed by expiry worker after rotation resets last_changed_at
CREATE TABLE IF NOT EXISTS notification_sent_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('secret', 'cert')),
  target_id   uuid NOT NULL,
  rule_id     uuid NOT NULL REFERENCES notification_rules (id) ON DELETE CASCADE,
  fired_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, rule_id)
);
