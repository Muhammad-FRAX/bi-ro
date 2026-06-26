-- Phase 4 — Audit log: append-only, never editable from the app

CREATE TABLE IF NOT EXISTS audit_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_api_client_id   uuid,  -- reserved for P8 API clients
  action                text NOT NULL,  -- 'reveal', 'login', 'logout', 'secret.create', etc.
  target_type           text,           -- 'secret', 'vault', 'user', etc.
  target_id             uuid,
  ip                    text,
  user_agent            text,
  result                text NOT NULL CHECK (result IN ('ok', 'denied', 'error')),
  ts                    timestamptz NOT NULL DEFAULT now(),
  detail                jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_actor_id_idx ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log(ts DESC);
