CREATE INDEX agent_commands_expiry_idx
  ON agent_commands (expires_at)
  WHERE state IN ('pending', 'delivered');

CREATE INDEX agent_commands_completion_idx
  ON agent_commands (completed_at)
  WHERE completed_at IS NOT NULL;
