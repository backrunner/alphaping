ALTER TABLE dashboards ADD COLUMN appearance_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(appearance_json) AND length(CAST(appearance_json AS BLOB)) <= 2048);
