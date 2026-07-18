ALTER TABLE retention_runs ADD COLUMN workspace_cursor INTEGER NOT NULL DEFAULT 0
  CHECK (workspace_cursor >= 0);
