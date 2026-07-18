ALTER TABLE machines ADD COLUMN purge_agent_cursor TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN purge_check_cursor INTEGER NOT NULL DEFAULT 0
  CHECK (purge_check_cursor >= 0);

CREATE INDEX agents_machine_history_idx ON agents (machine_id, id);

DROP INDEX check_configs_service_idx;
CREATE INDEX check_configs_service_idx
  ON check_configs (workspace_id, service_id, telemetry_pk);
