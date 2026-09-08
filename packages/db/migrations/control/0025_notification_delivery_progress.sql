ALTER TABLE notification_event_cursors
  ADD COLUMN last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0);

CREATE INDEX notification_deliveries_retention_idx
  ON notification_deliveries (workspace_id, state, updated_at, id);
