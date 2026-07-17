ALTER TABLE check_configs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0
  CHECK (retry_count BETWEEN 0 AND 3);

ALTER TABLE check_configs ADD COLUMN critical INTEGER NOT NULL DEFAULT 1
  CHECK (critical IN (0, 1));
