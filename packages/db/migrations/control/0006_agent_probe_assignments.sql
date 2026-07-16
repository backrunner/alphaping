ALTER TABLE check_configs ADD COLUMN assignment_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE check_configs ADD COLUMN config_bytes INTEGER NOT NULL DEFAULT 0;

UPDATE check_configs
SET assignment_revision = COALESCE(
  (
    SELECT m.desired_config_revision
    FROM agents a JOIN machines m ON m.id = a.machine_id
    WHERE a.id = check_configs.executor_agent_id AND a.status = 'active'
  ),
  0
)
WHERE executor_kind = 'agent';

UPDATE check_configs
SET config_bytes = length(request_json) + length(secret_refs_json) +
  CASE WHEN secret_refs_json = '{}' THEN 512 ELSE 20480 END;

CREATE INDEX check_configs_agent_assignment_idx
  ON check_configs (executor_agent_id, enabled, assignment_revision);
