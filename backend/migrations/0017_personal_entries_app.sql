-- Migration 0017: Allow personal vault entries to be linked to personal apps
ALTER TABLE personal_entries
  ADD COLUMN IF NOT EXISTS app_id UUID REFERENCES apps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS personal_entries_app_id_idx ON personal_entries (app_id) WHERE app_id IS NOT NULL;
