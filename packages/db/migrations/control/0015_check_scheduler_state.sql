CREATE TABLE check_scheduler_state (
  singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
  check_cursor INTEGER NOT NULL DEFAULT 0,
  machine_cursor INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID, STRICT;
