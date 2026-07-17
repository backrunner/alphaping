CREATE TABLE telemetry_resource_sequences_next (
  kind TEXT PRIMARY KEY NOT NULL CHECK (kind IN ('workspace', 'machine', 'service', 'check')),
  value INTEGER NOT NULL CHECK (value >= 0)
) WITHOUT ROWID, STRICT;

INSERT INTO telemetry_resource_sequences_next (kind, value)
  SELECT kind, value FROM telemetry_resource_sequences;

INSERT INTO telemetry_resource_sequences_next (kind, value)
  SELECT 'workspace', COALESCE(MAX(telemetry_pk), 0) FROM workspaces;

DROP TABLE telemetry_resource_sequences;
ALTER TABLE telemetry_resource_sequences_next RENAME TO telemetry_resource_sequences;

ALTER TABLE workspaces ADD COLUMN default_sampling_interval_seconds INTEGER NOT NULL DEFAULT 10
  CHECK (default_sampling_interval_seconds BETWEEN 5 AND 300);
