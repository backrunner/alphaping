ALTER TABLE check_configs ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1
  CHECK (config_revision > 0);

CREATE TRIGGER check_configs_config_revision_monotonic
BEFORE UPDATE OF config_revision ON check_configs
WHEN NEW.config_revision <= OLD.config_revision
BEGIN
  SELECT RAISE(ABORT, 'check config revision must increase');
END;

CREATE TRIGGER check_configs_config_revision_compat
AFTER UPDATE OF name, request_json, secret_refs_json, config_bytes,
                enabled, interval_seconds, phase_seconds, timeout_ms,
                retry_count, critical, failure_confirmations, recovery_confirmations
ON check_configs
WHEN NEW.config_revision = OLD.config_revision
BEGIN
  UPDATE check_configs
  SET config_revision = OLD.config_revision + 1
  WHERE id = NEW.id;
END;
