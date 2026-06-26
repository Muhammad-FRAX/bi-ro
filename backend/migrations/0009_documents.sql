-- Migration 0009: Document store
-- Stores metadata for uploaded files. File contents live on the bi-ro-uploads
-- Docker volume; storage_path is the relative path within that volume.
-- Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     TEXT        NOT NULL,
  mime         TEXT        NOT NULL,
  size         BIGINT      NOT NULL,
  checksum     TEXT        NOT NULL,     -- SHA-256 hex of file content
  storage_path TEXT        NOT NULL,     -- relative path within uploads volume
  linked_type  TEXT        CHECK (linked_type IN ('server', 'app', 'script', 'secret', 'vault')),
  linked_id    UUID,
  uploaded_by  UUID        NOT NULL REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

-- Index for entity attachment lookups
CREATE INDEX IF NOT EXISTS documents_linked_idx
  ON documents (linked_type, linked_id)
  WHERE deleted_at IS NULL;

-- Index for uploaded_by lookups
CREATE INDEX IF NOT EXISTS documents_uploaded_by_idx
  ON documents (uploaded_by);
