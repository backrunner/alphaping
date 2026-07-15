CREATE TABLE telemetry_resource_sequences (
  kind TEXT PRIMARY KEY NOT NULL CHECK (kind IN ('machine', 'service', 'check')),
  value INTEGER NOT NULL CHECK (value >= 0)
) WITHOUT ROWID, STRICT;

INSERT INTO telemetry_resource_sequences (kind, value) VALUES
  ('machine', 0),
  ('service', 0),
  ('check', 0);
