-- Phase 4 — Vault core: vaults, vault_members, secrets, secret_tags

CREATE TABLE IF NOT EXISTS vaults (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('team', 'personal')),
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vaults_owner_id_idx ON vaults(owner_id);

CREATE TABLE IF NOT EXISTS vault_members (
  vault_id      uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access        text NOT NULL CHECK (access IN ('view', 'reveal', 'manage')),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vault_id, user_id)
);

CREATE TABLE IF NOT EXISTS secrets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id              uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  type                  text NOT NULL CHECK (type IN ('server_login', 'db_credential', 'api_key', 'ssh_key', 'certificate', 'generic')),
  title                 text NOT NULL,
  username              text,
  host_url              text,
  logo_url              text,
  notes                 text,
  -- encrypted value fields (never returned on normal reads)
  ciphertext            bytea NOT NULL,
  iv                    bytea NOT NULL,
  auth_tag              bytea NOT NULL,
  wrapped_dek           bytea NOT NULL,
  key_version           text NOT NULL DEFAULT 'v1',
  -- rotation / expiry
  rotation_period_days  integer CHECK (rotation_period_days > 0),
  expires_at            timestamptz,
  last_changed_at       timestamptz NOT NULL DEFAULT now(),
  -- links to infra entities
  server_id             uuid REFERENCES servers(id) ON DELETE SET NULL,
  app_id                uuid REFERENCES apps(id) ON DELETE SET NULL,
  -- meta
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS secrets_vault_id_idx ON secrets(vault_id);
CREATE INDEX IF NOT EXISTS secrets_server_id_idx ON secrets(server_id) WHERE server_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS secrets_app_id_idx ON secrets(app_id) WHERE app_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS secret_tags (
  secret_id   uuid NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (secret_id, tag_id)
);
