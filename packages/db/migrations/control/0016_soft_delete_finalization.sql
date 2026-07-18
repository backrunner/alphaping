ALTER TABLE workspaces ADD COLUMN purge_started_at INTEGER;
ALTER TABLE machines ADD COLUMN purge_started_at INTEGER;
ALTER TABLE services ADD COLUMN purge_started_at INTEGER;
