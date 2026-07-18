CREATE TABLE service_state_sync_jobs (
  job_key TEXT PRIMARY KEY NOT NULL,
  sync_token TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  workspace_pk INTEGER NOT NULL CHECK (workspace_pk > 0),
  service_id TEXT NOT NULL,
  service_pk INTEGER NOT NULL CHECK (service_pk > 0),
  check_id TEXT,
  check_pk INTEGER,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'check_configuration', 'maintenance_window', 'maintenance_window_ended'
  )),
  protect_until INTEGER NOT NULL,
  last_attempted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((check_id IS NULL AND check_pk IS NULL) OR
         (check_id IS NOT NULL AND check_pk IS NOT NULL AND check_pk > 0))
) STRICT;

CREATE INDEX service_state_sync_jobs_scan_idx
  ON service_state_sync_jobs (last_attempted_at, job_key);
