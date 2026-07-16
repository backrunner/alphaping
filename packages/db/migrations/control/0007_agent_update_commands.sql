ALTER TABLE agent_commands ADD COLUMN attempt_limit INTEGER NOT NULL DEFAULT 3;
ALTER TABLE agent_commands ADD COLUMN payload_schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_commands ADD COLUMN delivery_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_commands ADD COLUMN result_code TEXT;
ALTER TABLE agent_commands ADD COLUMN result_json TEXT;

CREATE INDEX agent_commands_result_idx
  ON agent_commands (agent_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;
