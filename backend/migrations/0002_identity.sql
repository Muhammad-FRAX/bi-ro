-- Migration 0002: Identity & access schema
-- Creates users, roles, role_permissions, user_roles, user_permission_overrides,
-- settings, and setup_state tables. Seeds the four built-in roles with their
-- permission flag sets as defined in §3 of the design spec. All DDL is
-- idempotent (IF NOT EXISTS / ON CONFLICT).

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_mode             TEXT        NOT NULL CHECK (auth_mode IN ('self', 'keycloak', 'ldap')),
  external_id           TEXT,
  email                 TEXT        NOT NULL,
  display_name          TEXT        NOT NULL,
  password_hash         TEXT,
  totp_secret           TEXT,
  status                TEXT        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'pending', 'suspended')),
  force_password_change BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at         TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ
);
-- Partial index: allows email reuse after soft-delete (deleted_at IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq
  ON users (email) WHERE deleted_at IS NULL;

-- ── Roles ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  is_builtin  BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── Role → permission flags (one row per flag) ────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

-- ── User ↔ role assignments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- ── Per-user permission overrides (additive or subtractive) ──────────────────
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id    UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT    NOT NULL,
  allow      BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, permission)
);

-- ── Application settings (key/JSON-value store) ───────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT  PRIMARY KEY,
  value JSONB NOT NULL
);

-- ── First-launch state (enforced single row via bool PK = TRUE) ──────────────
CREATE TABLE IF NOT EXISTS setup_state (
  id             BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  initialized    BOOLEAN     NOT NULL DEFAULT FALSE,
  auth_mode      TEXT        CHECK (auth_mode IN ('self', 'keycloak', 'ldap')),  -- NULL until initialized
  initialized_at TIMESTAMPTZ
);

INSERT INTO setup_state (initialized)
  VALUES (FALSE)
  ON CONFLICT (id) DO NOTHING;

-- ── Built-in roles + permission seeds ────────────────────────────────────────
-- Idempotent: ON CONFLICT DO UPDATE ensures is_builtin stays TRUE if re-run;
-- role_permissions uses ON CONFLICT DO NOTHING for flag rows.

WITH
  ins_admin AS (
    INSERT INTO roles (name, description, is_builtin)
      VALUES ('admin', 'Full administrative access.', TRUE)
      ON CONFLICT (name) DO UPDATE SET is_builtin = TRUE
      RETURNING id
  ),
  ins_editor AS (
    INSERT INTO roles (name, description, is_builtin)
      VALUES ('editor', 'Manage infrastructure, docs, and secrets in granted vaults.', TRUE)
      ON CONFLICT (name) DO UPDATE SET is_builtin = TRUE
      RETURNING id
  ),
  ins_viewer_secrets AS (
    INSERT INTO roles (name, description, is_builtin)
      VALUES ('viewer_secrets', 'Read infrastructure and reveal granted secrets.', TRUE)
      ON CONFLICT (name) DO UPDATE SET is_builtin = TRUE
      RETURNING id
  ),
  ins_viewer AS (
    INSERT INTO roles (name, description, is_builtin)
      VALUES ('viewer', 'Read infrastructure documentation only.', TRUE)
      ON CONFLICT (name) DO UPDATE SET is_builtin = TRUE
      RETURNING id
  ),
  admin_perms (permission) AS (
    VALUES
      ('infra.read'), ('servers.write'), ('scripts.write'),  ('docs.read'),
      ('docs.write'), ('secrets.view'),  ('secrets.reveal'), ('secrets.create'),
      ('secrets.edit'), ('secrets.delete'), ('vault.manage_access'),
      ('users.manage'), ('roles.manage'), ('settings.manage'),
      ('api_keys.manage'), ('audit.read')
  ),
  editor_perms (permission) AS (
    VALUES
      ('infra.read'),    ('servers.write'),  ('scripts.write'),
      ('docs.read'),     ('docs.write'),     ('secrets.view'),
      ('secrets.reveal'),('secrets.create'), ('secrets.edit'),
      ('secrets.delete')
  ),
  viewer_secrets_perms (permission) AS (
    VALUES ('infra.read'), ('docs.read'), ('secrets.view'), ('secrets.reveal')
  ),
  viewer_perms (permission) AS (
    VALUES ('infra.read'), ('docs.read')
  )
INSERT INTO role_permissions (role_id, permission)
  SELECT id, permission FROM ins_admin          CROSS JOIN admin_perms
  UNION ALL
  SELECT id, permission FROM ins_editor         CROSS JOIN editor_perms
  UNION ALL
  SELECT id, permission FROM ins_viewer_secrets CROSS JOIN viewer_secrets_perms
  UNION ALL
  SELECT id, permission FROM ins_viewer         CROSS JOIN viewer_perms
ON CONFLICT (role_id, permission) DO NOTHING;

-- ── Performance indexes ───────────────────────────────────────────────────────
-- PK (user_id, role_id) covers user→roles lookups; add reverse for role→users.
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx
  ON user_roles (role_id);
-- PK (role_id, permission) covers role→perms; add reverse for perm→roles.
CREATE INDEX IF NOT EXISTS role_permissions_permission_idx
  ON role_permissions (permission);
