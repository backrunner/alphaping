ALTER TABLE machines ADD COLUMN container_catalog_digest BLOB;

CREATE TABLE containers (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  runtime TEXT NOT NULL CHECK (runtime IN (
    'docker', 'colima-docker', 'colima-containerd', 'apple-container', 'unknown'
  )),
  runtime_instance TEXT NOT NULL,
  runtime_container_id TEXT NOT NULL,
  name TEXT NOT NULL,
  image TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (machine_id, runtime, runtime_instance, runtime_container_id)
) STRICT;

CREATE INDEX containers_machine_idx ON containers (workspace_id, machine_id, deleted_at);
