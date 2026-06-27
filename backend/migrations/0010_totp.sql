-- Migration 0010: TOTP (C7.4)
-- Adds totp_enabled and totp_enrolled_at to the users table.
-- totp_secret already exists (added in 0002_identity.sql).
-- totp_enabled=TRUE means TOTP is required at login AND can be used for step-up.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;

-- Index for quick "does this user have TOTP?" lookups
CREATE INDEX IF NOT EXISTS users_totp_enabled_idx
  ON users (id) WHERE totp_enabled = TRUE;
