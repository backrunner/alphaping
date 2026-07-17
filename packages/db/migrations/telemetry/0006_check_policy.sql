ALTER TABLE check_latest ADD COLUMN critical INTEGER NOT NULL DEFAULT 1
  CHECK (critical IN (0, 1));
