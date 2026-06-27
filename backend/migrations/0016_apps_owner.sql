-- Migration 0016: Personal app ownership
-- owner_id = NULL means the app is orphaned/legacy (admins only)
-- owner_id = set means the app belongs to that user personally
-- vault_id + owner_id = set means it's a vault app created by that user

ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS apps_owner_id_idx ON apps (owner_id) WHERE owner_id IS NOT NULL;
