-- Phase 9: add integer key_version column to secrets for KEK rotation tracking
-- The text key_version column already exists from 0005_vault.sql
-- We add an integer column key_version_int for rotation counter tracking

ALTER TABLE secrets ADD COLUMN IF NOT EXISTS key_version_int INTEGER NOT NULL DEFAULT 1;
