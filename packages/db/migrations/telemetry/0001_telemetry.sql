PRAGMA foreign_keys = ON;

CREATE TABLE agent_replay_state (
  agent_id TEXT NOT NULL,
  key_epoch INTEGER NOT NULL,
  highest_sequence INTEGER NOT NULL,
  window_bitmap BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, key_epoch)
) WITHOUT ROWID, STRICT;

CREATE TABLE telemetry_blocks_5m (
  machine_pk INTEGER NOT NULL,
  workspace_pk INTEGER NOT NULL,
  block_start INTEGER NOT NULL,
  report_0 BLOB,
  report_id_0 BLOB,
  payload_hash_0 BLOB,
  report_1 BLOB,
  report_id_1 BLOB,
  payload_hash_1 BLOB,
  report_2 BLOB,
  report_id_2 BLOB,
  payload_hash_2 BLOB,
  report_3 BLOB,
  report_id_3 BLOB,
  payload_hash_3 BLOB,
  report_4 BLOB,
  report_id_4 BLOB,
  payload_hash_4 BLOB,
  schema_version INTEGER NOT NULL,
  flags INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (machine_pk, block_start)
) WITHOUT ROWID, STRICT;

CREATE TABLE machine_latest (
  machine_pk INTEGER PRIMARY KEY NOT NULL,
  workspace_pk INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'healthy', 'degraded', 'down', 'offline', 'maintenance', 'unknown'
  )),
  cpu_permille INTEGER NOT NULL,
  memory_used_bytes INTEGER NOT NULL,
  memory_total_bytes INTEGER NOT NULL,
  storage_used_bytes INTEGER NOT NULL,
  storage_total_bytes INTEGER NOT NULL,
  network_rx_bps INTEGER NOT NULL,
  network_tx_bps INTEGER NOT NULL,
  network_rx_total INTEGER NOT NULL,
  network_tx_total INTEGER NOT NULL,
  report_id BLOB NOT NULL
) STRICT;

CREATE TABLE machine_rollups_5m (
  machine_pk INTEGER NOT NULL,
  workspace_pk INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  cpu_avg_permille INTEGER NOT NULL,
  cpu_max_permille INTEGER NOT NULL,
  memory_avg_bytes INTEGER NOT NULL,
  storage_max_bytes INTEGER NOT NULL,
  network_rx_bytes INTEGER NOT NULL,
  network_tx_bytes INTEGER NOT NULL,
  PRIMARY KEY (machine_pk, bucket_start)
) WITHOUT ROWID, STRICT;

CREATE TABLE machine_rollups_1h (
  machine_pk INTEGER NOT NULL,
  workspace_pk INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  cpu_avg_permille INTEGER NOT NULL,
  cpu_max_permille INTEGER NOT NULL,
  memory_avg_bytes INTEGER NOT NULL,
  storage_max_bytes INTEGER NOT NULL,
  network_rx_bytes INTEGER NOT NULL,
  network_tx_bytes INTEGER NOT NULL,
  PRIMARY KEY (machine_pk, bucket_start)
) WITHOUT ROWID, STRICT;

CREATE TABLE check_result_blocks_5m (
  check_pk INTEGER NOT NULL,
  workspace_pk INTEGER NOT NULL,
  block_start INTEGER NOT NULL,
  result_0 BLOB,
  result_id_0 BLOB,
  payload_hash_0 BLOB,
  result_1 BLOB,
  result_id_1 BLOB,
  payload_hash_1 BLOB,
  result_2 BLOB,
  result_id_2 BLOB,
  payload_hash_2 BLOB,
  result_3 BLOB,
  result_id_3 BLOB,
  payload_hash_3 BLOB,
  result_4 BLOB,
  result_id_4 BLOB,
  payload_hash_4 BLOB,
  schema_version INTEGER NOT NULL,
  flags INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (check_pk, block_start)
) WITHOUT ROWID, STRICT;

CREATE TABLE check_latest (
  check_pk INTEGER PRIMARY KEY NOT NULL,
  workspace_pk INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('healthy', 'degraded', 'down', 'unknown')),
  latency_ms INTEGER,
  failure_code TEXT,
  result_id BLOB NOT NULL
) STRICT;

CREATE TABLE check_rollups_5m (
  check_pk INTEGER NOT NULL,
  workspace_pk INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  healthy_count INTEGER NOT NULL,
  degraded_count INTEGER NOT NULL,
  down_count INTEGER NOT NULL,
  latency_avg_ms INTEGER,
  latency_max_ms INTEGER,
  PRIMARY KEY (check_pk, bucket_start)
) WITHOUT ROWID, STRICT;

CREATE TABLE check_rollups_1h (
  check_pk INTEGER NOT NULL,
  workspace_pk INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  healthy_count INTEGER NOT NULL,
  degraded_count INTEGER NOT NULL,
  down_count INTEGER NOT NULL,
  latency_avg_ms INTEGER,
  latency_max_ms INTEGER,
  PRIMARY KEY (check_pk, bucket_start)
) WITHOUT ROWID, STRICT;

CREATE TABLE state_events (
  workspace_pk INTEGER NOT NULL,
  resource_type INTEGER NOT NULL CHECK (resource_type IN (1, 2)),
  resource_pk INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  event_id BLOB NOT NULL,
  previous_state TEXT NOT NULL,
  current_state TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_pk, occurred_at, event_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE workspace_status_summary (
  workspace_pk INTEGER PRIMARY KEY NOT NULL,
  machine_total INTEGER NOT NULL DEFAULT 0,
  machine_healthy INTEGER NOT NULL DEFAULT 0,
  machine_degraded INTEGER NOT NULL DEFAULT 0,
  machine_down INTEGER NOT NULL DEFAULT 0,
  machine_offline INTEGER NOT NULL DEFAULT 0,
  service_down INTEGER NOT NULL DEFAULT 0,
  network_rx_bps INTEGER NOT NULL DEFAULT 0,
  network_tx_bps INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE retention_cursors (
  workspace_pk INTEGER NOT NULL,
  table_kind TEXT NOT NULL CHECK (table_kind IN (
    'machine_raw', 'check_raw', 'machine_5m', 'check_5m', 'machine_1h', 'check_1h', 'event'
  )),
  resource_pk INTEGER NOT NULL DEFAULT 0,
  time_cursor INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_pk, table_kind)
) WITHOUT ROWID, STRICT;

CREATE TABLE retention_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  deleted_rows INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
) STRICT;
