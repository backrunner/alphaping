ALTER TABLE services ADD COLUMN slug TEXT;

UPDATE services SET slug = id WHERE slug IS NULL;

CREATE UNIQUE INDEX services_workspace_slug_uq
  ON services (workspace_id, slug)
  WHERE deleted_at IS NULL;

ALTER TABLE check_configs ADD COLUMN failure_confirmations INTEGER NOT NULL DEFAULT 3
  CHECK (failure_confirmations BETWEEN 1 AND 20);
ALTER TABLE check_configs ADD COLUMN recovery_confirmations INTEGER NOT NULL DEFAULT 2
  CHECK (recovery_confirmations BETWEEN 1 AND 20);
ALTER TABLE check_configs ADD COLUMN secret_refs_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX check_configs_service_idx ON check_configs (workspace_id, service_id);

CREATE TABLE check_assertions (
  id TEXT PRIMARY KEY NOT NULL,
  check_id TEXT NOT NULL REFERENCES check_configs (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('status', 'latency', 'header', 'jsonpath', 'body')),
  operator TEXT NOT NULL CHECK (operator IN (
    'exists', 'equals', 'contains', 'matches', 'type', 'greater_than', 'less_than'
  )),
  selector TEXT,
  expected_json TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('degraded', 'down')),
  created_at INTEGER NOT NULL,
  UNIQUE (check_id, sort_order)
) STRICT;

CREATE TABLE check_secrets (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  wrapped_value BLOB NOT NULL,
  wrapping_key_id TEXT NOT NULL,
  nonce BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER
) STRICT;

CREATE INDEX check_secrets_workspace_idx ON check_secrets (workspace_id, id);

ALTER TABLE incidents ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN deleted_at INTEGER;

CREATE TABLE incident_resources (
  incident_id TEXT NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('machine', 'service')),
  resource_id TEXT NOT NULL,
  impact TEXT NOT NULL CHECK (impact IN ('degraded', 'down')),
  PRIMARY KEY (incident_id, resource_type, resource_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX incident_resources_resource_idx
  ON incident_resources (resource_type, resource_id, incident_id);

ALTER TABLE incident_updates ADD COLUMN published_at INTEGER;
UPDATE incident_updates SET published_at = created_at WHERE published_at IS NULL;

ALTER TABLE announcements ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'
  CHECK (severity IN ('info', 'maintenance', 'minor', 'major', 'critical'));
ALTER TABLE announcements ADD COLUMN visibility TEXT NOT NULL DEFAULT 'authenticated'
  CHECK (visibility IN ('private', 'authenticated', 'public'));
ALTER TABLE announcements ADD COLUMN updated_at INTEGER;
ALTER TABLE announcements ADD COLUMN deleted_at INTEGER;
UPDATE announcements SET updated_at = created_at WHERE updated_at IS NULL;
