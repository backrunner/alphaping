ALTER TABLE check_latest ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 0
  CHECK (config_revision >= 0);
