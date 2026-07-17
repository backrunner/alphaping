CREATE TABLE artifact_retention_cursors (
  prefix TEXT PRIMARY KEY NOT NULL CHECK (prefix IN ('exports/v1/', 'backups/v1/')),
  last_key TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID, STRICT;
