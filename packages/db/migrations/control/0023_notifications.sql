CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  provider TEXT NOT NULL CHECK (provider IN (
    'resend', 'smtp', 'discord', 'telegram', 'slack', 'bark'
  )),
  config_ciphertext BLOB NOT NULL,
  config_nonce BLOB NOT NULL CHECK (length(config_nonce) = 12),
  wrapping_key_id TEXT NOT NULL DEFAULT 'v1',
  config_summary_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX notification_channels_workspace_idx
  ON notification_channels (workspace_id, enabled, provider, name, id);

CREATE TABLE notification_rules (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('machine', 'service')),
  resource_id TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('availability', 'resource', 'recovery')),
  channel_id TEXT NOT NULL REFERENCES notification_channels (id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (channel_id, resource_type, resource_id, dimension)
) STRICT;

CREATE INDEX notification_rules_resource_idx
  ON notification_rules (workspace_id, resource_type, resource_id, dimension, enabled, channel_id);

CREATE TABLE notification_event_cursors (
  singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
  last_occurred_at INTEGER NOT NULL DEFAULT 0,
  last_event_id BLOB NOT NULL DEFAULT X'',
  last_resource_type INTEGER NOT NULL DEFAULT 0,
  last_resource_pk INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO notification_event_cursors (singleton) VALUES (1);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels (id) ON DELETE CASCADE,
  source_workspace_pk INTEGER NOT NULL,
  source_resource_type INTEGER NOT NULL CHECK (source_resource_type IN (1, 2)),
  source_resource_pk INTEGER NOT NULL,
  source_occurred_at INTEGER NOT NULL,
  source_event_id TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('availability', 'resource', 'recovery')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'delivering', 'sent', 'dead'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claim_until INTEGER,
  last_error TEXT,
  response_status INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  UNIQUE (
    channel_id,
    source_workspace_pk,
    source_resource_type,
    source_resource_pk,
    source_occurred_at,
    source_event_id
  )
) STRICT;

CREATE INDEX notification_deliveries_claim_idx
  ON notification_deliveries (state, next_attempt_at, claim_until, created_at, id);

CREATE INDEX notification_deliveries_workspace_idx
  ON notification_deliveries (workspace_id, created_at DESC, id);
