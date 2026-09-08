CREATE TABLE notification_event_queue (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_pk INTEGER NOT NULL,
  resource_type INTEGER NOT NULL CHECK (resource_type IN (1, 2)),
  resource_pk INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  event_id BLOB NOT NULL,
  UNIQUE (resource_type, resource_pk, occurred_at, event_id),
  FOREIGN KEY (resource_type, resource_pk, occurred_at, event_id)
    REFERENCES state_events (resource_type, resource_pk, occurred_at, event_id)
    ON DELETE CASCADE
) STRICT;

CREATE TRIGGER state_events_notification_queue
AFTER INSERT ON state_events
WHEN NEW.resource_type IN (1, 2)
BEGIN
  INSERT INTO notification_event_queue
    (workspace_pk, resource_type, resource_pk, occurred_at, event_id)
  VALUES
    (NEW.workspace_pk, NEW.resource_type, NEW.resource_pk, NEW.occurred_at, NEW.event_id);
END;
