CREATE INDEX retention_runs_started_at_idx
  ON retention_runs (started_at, run_id);
