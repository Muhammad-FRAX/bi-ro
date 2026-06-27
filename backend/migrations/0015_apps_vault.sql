-- Migration 0015: Link apps to vaults (vault-owned team apps)
-- vault_id = NULL  → general catalog app, visible to all with infra.read
-- vault_id = set   → vault-scoped team app, visible only to vault members

ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS vault_id UUID REFERENCES vaults(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS apps_vault_id_idx ON apps (vault_id) WHERE vault_id IS NOT NULL;
