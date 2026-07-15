PRAGMA foreign_keys = ON;

CREATE TABLE installations (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete')),
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;

CREATE UNIQUE INDEX installations_complete_uq
  ON installations (state)
  WHERE state = 'complete';

CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX user_email_uq ON user (email);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX session_token_uq ON session (token);
CREATE INDEX session_user_id_idx ON session (user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX account_user_id_idx ON account (user_id);
CREATE UNIQUE INDEX account_provider_uq ON account (provider_id, account_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
) STRICT;

CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  telemetry_pk INTEGER NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  default_dashboard_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE TABLE memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'suspended')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE dashboards (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'authenticated', 'public')),
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (workspace_id, slug)
) STRICT;

CREATE TABLE dashboard_resources (
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('machine', 'service')),
  resource_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  public_override TEXT NOT NULL DEFAULT 'inherit'
    CHECK (public_override IN ('inherit', 'allow', 'deny')),
  PRIMARY KEY (dashboard_id, resource_type, resource_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE resource_grants (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('dashboard', 'machine', 'container', 'service', 'incident')),
  resource_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('view', 'manage')),
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL,
  UNIQUE (subject_user_id, resource_type, resource_id, capability)
) STRICT;

CREATE INDEX resource_grants_subject_idx
  ON resource_grants (workspace_id, subject_user_id, resource_type);

CREATE TABLE resource_public_policies (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('machine', 'container', 'service')),
  resource_id TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  projection_profile TEXT NOT NULL CHECK (projection_profile IN ('summary', 'detailed')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, resource_type, resource_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE machines (
  id TEXT PRIMARY KEY NOT NULL,
  telemetry_pk INTEGER NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expected_host TEXT,
  labels_json TEXT NOT NULL DEFAULT '{}',
  sampling_interval_seconds INTEGER NOT NULL DEFAULT 10
    CHECK (sampling_interval_seconds BETWEEN 5 AND 300),
  report_interval_seconds INTEGER NOT NULL DEFAULT 60
    CHECK (report_interval_seconds BETWEEN 60 AND 900),
  offline_after_seconds INTEGER NOT NULL DEFAULT 150
    CHECK (offline_after_seconds BETWEEN 60 AND 86400),
  container_monitoring_enabled INTEGER NOT NULL DEFAULT 0 CHECK (container_monitoring_enabled IN (0, 1)),
  maintenance_until INTEGER,
  desired_config_revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE INDEX machines_workspace_idx ON machines (workspace_id, deleted_at);

CREATE TABLE agent_enrollment_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  token_digest BLOB NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX agent_enrollment_expiry_idx ON agent_enrollment_tokens (expires_at);

CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  identity_public_key BLOB NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  applied_config_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
) STRICT;

CREATE UNIQUE INDEX agents_one_active_machine_uq
  ON agents (machine_id)
  WHERE status = 'active';

CREATE TABLE agent_keys (
  agent_id TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  key_epoch INTEGER NOT NULL,
  wrapped_data_key BLOB NOT NULL,
  wrapping_key_id TEXT NOT NULL,
  nonce_prefix BLOB NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_until INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (agent_id, key_epoch)
) WITHOUT ROWID, STRICT;

CREATE TABLE agent_commands (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'refresh_config', 'check_update', 'install_version', 'redetect_runtimes'
  )),
  payload_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK (state IN (
    'pending', 'delivered', 'succeeded', 'failed', 'expired'
  )),
  not_before INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  completed_at INTEGER
) STRICT;

CREATE INDEX agent_commands_delivery_idx ON agent_commands (agent_id, state, not_before);

CREATE TABLE services (
  id TEXT PRIMARY KEY NOT NULL,
  telemetry_pk INTEGER NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status_rule_json TEXT NOT NULL DEFAULT '{}',
  maintenance_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE INDEX services_workspace_idx ON services (workspace_id, deleted_at);

CREATE TABLE check_configs (
  id TEXT PRIMARY KEY NOT NULL,
  telemetry_pk INTEGER NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('http', 'tcp', 'icmp')),
  executor_kind TEXT NOT NULL CHECK (executor_kind IN ('cloudflare', 'agent')),
  executor_agent_id TEXT REFERENCES agents (id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (interval_seconds BETWEEN 5 AND 86400),
  phase_seconds INTEGER NOT NULL DEFAULT 0 CHECK (phase_seconds BETWEEN 0 AND 86399),
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 100 AND 30000),
  request_json TEXT NOT NULL,
  last_claimed_slot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE incidents (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
  state TEXT NOT NULL CHECK (state IN ('investigating', 'identified', 'monitoring', 'resolved')),
  starts_at INTEGER NOT NULL,
  resolved_at INTEGER,
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX incident_updates_timeline_idx ON incident_updates (incident_id, created_at);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX announcements_visibility_idx ON announcements (workspace_id, starts_at, expires_at);

CREATE TABLE retention_policies (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  raw_days INTEGER NOT NULL DEFAULT 7 CHECK (raw_days BETWEEN 1 AND 90),
  rollup_5m_days INTEGER NOT NULL DEFAULT 30 CHECK (rollup_5m_days BETWEEN 7 AND 365),
  rollup_1h_days INTEGER NOT NULL DEFAULT 365 CHECK (rollup_1h_days BETWEEN 30 AND 3650),
  event_days INTEGER NOT NULL DEFAULT 365 CHECK (event_days BETWEEN 30 AND 3650),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID, STRICT;
