-- Migration 0001: Bootstrap extensions
-- Installs pgcrypto for uuid generation and cryptographic functions.
-- This migration is idempotent via IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
