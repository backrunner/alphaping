CREATE INDEX incident_updates_projection_timeline_idx
  ON incident_updates (incident_id, COALESCE(published_at, created_at) DESC, id);
