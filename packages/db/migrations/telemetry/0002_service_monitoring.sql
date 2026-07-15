ALTER TABLE check_latest ADD COLUMN service_pk INTEGER;
ALTER TABLE check_latest ADD COLUMN failure_summary TEXT;
ALTER TABLE check_latest ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE check_latest ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE service_latest (
  service_pk INTEGER PRIMARY KEY NOT NULL,
  workspace_pk INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'healthy', 'degraded', 'down', 'maintenance', 'unknown'
  )),
  status_since INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  last_transition_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE status_buckets (
  resource_type INTEGER NOT NULL CHECK (resource_type IN (1, 2)),
  resource_pk INTEGER NOT NULL,
  workspace_pk INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  bucket_seconds INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'healthy', 'degraded', 'down', 'maintenance', 'unknown'
  )),
  availability_permille INTEGER NOT NULL CHECK (availability_permille BETWEEN 0 AND 1000),
  latency_avg_ms INTEGER,
  latency_max_ms INTEGER,
  summary_code TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_pk, bucket_seconds, bucket_start)
) WITHOUT ROWID, STRICT;
