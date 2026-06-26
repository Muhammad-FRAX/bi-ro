-- Migration 0004: Filesystem snapshot schema
-- Creates fs_snapshots and fs_nodes tables for C3.2/C3.3.
-- All DDL is idempotent (IF NOT EXISTS).

-- ── Filesystem snapshots ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_snapshots (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  root_path    TEXT        NOT NULL,
  max_depth    INTEGER     NOT NULL,
  host         TEXT        NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  created_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Filesystem nodes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_nodes (
  id          UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID   NOT NULL REFERENCES fs_snapshots(id) ON DELETE CASCADE,
  path        TEXT   NOT NULL,
  type        TEXT   NOT NULL CHECK (type IN ('dir', 'file')),
  size        BIGINT,
  mtime       TIMESTAMPTZ,
  linked_type TEXT   CHECK (linked_type IN ('script', 'app')),
  linked_id   UUID
);

-- Index for fast snapshot lookup (from §20 F7)
CREATE INDEX IF NOT EXISTS fs_nodes_snapshot_id_idx ON fs_nodes(snapshot_id);
