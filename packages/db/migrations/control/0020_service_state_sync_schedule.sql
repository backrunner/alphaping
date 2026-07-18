ALTER TABLE service_state_sync_jobs ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0
  CHECK (next_attempt_at >= 0);

UPDATE service_state_sync_jobs
SET next_attempt_at = last_attempted_at;

DROP INDEX service_state_sync_jobs_scan_idx;

CREATE INDEX service_state_sync_jobs_scan_idx
  ON service_state_sync_jobs (next_attempt_at, last_attempted_at, job_key);
