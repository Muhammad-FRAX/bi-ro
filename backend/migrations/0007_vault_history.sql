-- Phase 4 — Secret history: encrypted prior values on rotation

CREATE TABLE IF NOT EXISTS secret_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id     uuid NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  -- encrypted prior value (same envelope format as secrets)
  ciphertext    bytea NOT NULL,
  iv            bytea NOT NULL,
  auth_tag      bytea NOT NULL,
  wrapped_dek   bytea NOT NULL,
  key_version   text NOT NULL DEFAULT 'v1',
  changed_at    timestamptz NOT NULL DEFAULT now(),
  changed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  reason        text
);

CREATE INDEX IF NOT EXISTS secret_history_secret_id_idx ON secret_history(secret_id);
