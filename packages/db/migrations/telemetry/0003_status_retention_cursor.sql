ALTER TABLE retention_cursors RENAME TO retention_cursors_legacy;

CREATE TABLE retention_cursors (
  workspace_pk INTEGER NOT NULL,
  table_kind TEXT NOT NULL CHECK (table_kind IN (
    'machine_raw', 'check_raw', 'machine_5m', 'check_5m',
    'machine_1h', 'check_1h', 'status_5m', 'event'
  )),
  resource_pk INTEGER NOT NULL DEFAULT 0,
  time_cursor INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_pk, table_kind)
) WITHOUT ROWID, STRICT;

INSERT INTO retention_cursors
  (workspace_pk, table_kind, resource_pk, time_cursor, lease_until, updated_at)
SELECT workspace_pk, table_kind, resource_pk, time_cursor, lease_until, updated_at
FROM retention_cursors_legacy;

DROP TABLE retention_cursors_legacy;
