CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_digest BLOB NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  revoked_at INTEGER,
  created_by TEXT NOT NULL REFERENCES user (id),
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX workspace_invitations_pending_email_uq
  ON workspace_invitations (workspace_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX workspace_invitations_expiry_idx
  ON workspace_invitations (workspace_id, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES user (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  before_digest TEXT,
  after_digest TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX audit_logs_workspace_time_idx
  ON audit_logs (workspace_id, created_at DESC);

ALTER TABLE retention_policies
  ADD COLUMN audit_log_days INTEGER NOT NULL DEFAULT 365
  CHECK (audit_log_days BETWEEN 30 AND 3650);

ALTER TABLE retention_policies
  ADD COLUMN expired_announcement_grace_days INTEGER NOT NULL DEFAULT 7
  CHECK (expired_announcement_grace_days BETWEEN 1 AND 90);

ALTER TABLE retention_policies
  ADD COLUMN soft_delete_grace_days INTEGER NOT NULL DEFAULT 7
  CHECK (soft_delete_grace_days BETWEEN 1 AND 90);
