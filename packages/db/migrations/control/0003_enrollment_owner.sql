ALTER TABLE agent_enrollment_tokens ADD COLUMN used_by_agent_id TEXT;

CREATE UNIQUE INDEX agent_enrollment_used_by_uq
  ON agent_enrollment_tokens (used_by_agent_id)
  WHERE used_by_agent_id IS NOT NULL;
