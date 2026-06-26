-- Migration 0003: Infrastructure documentation schema
-- Creates servers, tags, server_tags, apps, app_instances, ports, connections.
-- Per §4.1 + §8. app_instances is required by CEO F1.3: "ports/connections reference it".
-- All DDL is idempotent (IF NOT EXISTS).

-- ── Servers ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname     TEXT        NOT NULL,
  aliases      JSONB       NOT NULL DEFAULT '[]',
  ips          JSONB       NOT NULL DEFAULT '[]',
  environment  TEXT        NOT NULL DEFAULT 'other'
               CHECK (environment IN ('prod', 'staging', 'dev', 'other')),
  os           TEXT,
  location     TEXT,
  cpu_ram_disk TEXT,
  owner_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'decommissioned', 'maintenance')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS servers_hostname_idx     ON servers (hostname) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS servers_environment_idx  ON servers (environment) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS servers_status_idx       ON servers (status) WHERE deleted_at IS NULL;

-- ── Tags ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#a78bfa'
);

-- ── Server ↔ tag join ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS server_tags (
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  tag_id    UUID NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (server_id, tag_id)
);

CREATE INDEX IF NOT EXISTS server_tags_tag_idx ON server_tags (tag_id);

-- ── Apps catalog ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apps (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  category   TEXT,
  vendor     TEXT,
  version    TEXT,
  eol_date   DATE,
  logo_url   TEXT,
  docs_url   TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Unique name among non-deleted apps; allows reuse of a name after soft-delete
CREATE UNIQUE INDEX IF NOT EXISTS apps_name_uq ON apps (name) WHERE deleted_at IS NULL;

-- ── App instances (CEO F1.3) ──────────────────────────────────────────────────
-- First-class addressable nodes for topology + connections. "App A running on
-- server X" is an app_instance, not a loose (app_id, server_id) pair.
CREATE TABLE IF NOT EXISTS app_instances (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id  UUID        NOT NULL REFERENCES servers(id)  ON DELETE CASCADE,
  app_id     UUID        NOT NULL REFERENCES apps(id)     ON DELETE CASCADE,
  version    TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, app_id)
);

CREATE INDEX IF NOT EXISTS app_instances_server_idx ON app_instances (server_id);
CREATE INDEX IF NOT EXISTS app_instances_app_idx    ON app_instances (app_id);

-- ── Ports ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id       UUID NOT NULL REFERENCES servers(id)        ON DELETE CASCADE,
  app_instance_id UUID          REFERENCES app_instances(id)  ON DELETE SET NULL,
  number          INT  NOT NULL CHECK (number BETWEEN 1 AND 65535),
  protocol        TEXT NOT NULL DEFAULT 'tcp'
                  CHECK (protocol IN ('tcp', 'udp')),
  app_label       TEXT,
  exposure        TEXT NOT NULL DEFAULT 'internal'
                  CHECK (exposure IN ('internal', 'external', 'localhost')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'unknown')),
  description     TEXT
);

-- A server cannot bind two ports on the same (number, protocol)
CREATE UNIQUE INDEX IF NOT EXISTS ports_server_number_proto_uq
  ON ports (server_id, number, protocol);

CREATE INDEX IF NOT EXISTS ports_server_idx          ON ports (server_id);
CREATE INDEX IF NOT EXISTS ports_app_instance_idx    ON ports (app_instance_id) WHERE app_instance_id IS NOT NULL;

-- ── Connections ───────────────────────────────────────────────────────────────
-- Directed edge between two app_instances (CEO F1.3: real nodes, not loose pairs).
CREATE TABLE IF NOT EXISTS connections (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_app_instance_id UUID        NOT NULL REFERENCES app_instances(id) ON DELETE CASCADE,
  to_app_instance_id   UUID        NOT NULL REFERENCES app_instances(id) ON DELETE CASCADE,
  label                TEXT,
  protocol             TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS connections_from_idx ON connections (from_app_instance_id);
CREATE INDEX IF NOT EXISTS connections_to_idx   ON connections (to_app_instance_id);
