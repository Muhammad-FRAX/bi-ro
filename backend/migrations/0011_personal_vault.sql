-- Personal vault: per-user key storage and personal entries
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personal_vault_key_salt BYTEA,
  ADD COLUMN IF NOT EXISTS personal_vault_key_cipher BYTEA;

CREATE TABLE IF NOT EXISTS personal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  username TEXT,
  logo_url TEXT,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  notes_cipher BYTEA,
  notes_iv BYTEA,
  notes_auth_tag BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS personal_entries_owner_idx ON personal_entries(owner_id) WHERE deleted_at IS NULL;
