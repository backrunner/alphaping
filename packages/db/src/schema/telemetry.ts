import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const machineLatest = sqliteTable("machine_latest", {
  machinePk: integer("machine_pk").primaryKey(),
  workspacePk: integer("workspace_pk").notNull(),
  observedAt: integer("observed_at").notNull(),
  receivedAt: integer("received_at").notNull(),
  state: text("state").notNull(),
  cpuPermille: integer("cpu_permille").notNull(),
  memoryUsedBytes: integer("memory_used_bytes").notNull(),
  memoryTotalBytes: integer("memory_total_bytes").notNull(),
  storageUsedBytes: integer("storage_used_bytes").notNull(),
  storageTotalBytes: integer("storage_total_bytes").notNull(),
  networkRxBps: integer("network_rx_bps").notNull(),
  networkTxBps: integer("network_tx_bps").notNull(),
  networkRxTotal: integer("network_rx_total").notNull(),
  networkTxTotal: integer("network_tx_total").notNull(),
  reportId: blob("report_id", { mode: "buffer" }).notNull(),
});

export const checkLatest = sqliteTable("check_latest", {
  checkPk: integer("check_pk").primaryKey(),
  workspacePk: integer("workspace_pk").notNull(),
  servicePk: integer("service_pk"),
  observedAt: integer("observed_at").notNull(),
  state: text("state").notNull(),
  latencyMs: integer("latency_ms"),
  failureCode: text("failure_code"),
  failureSummary: text("failure_summary"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  consecutiveSuccesses: integer("consecutive_successes").notNull().default(0),
  resultId: blob("result_id", { mode: "buffer" }).notNull(),
});

export const serviceLatest = sqliteTable("service_latest", {
  servicePk: integer("service_pk").primaryKey(),
  workspacePk: integer("workspace_pk").notNull(),
  state: text("state", {
    enum: ["healthy", "degraded", "down", "maintenance", "unknown"],
  }).notNull(),
  statusSince: integer("status_since").notNull(),
  reasonCode: text("reason_code").notNull(),
  lastTransitionAt: integer("last_transition_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const statusBuckets = sqliteTable("status_buckets", {
  resourceType: integer("resource_type").notNull(),
  resourcePk: integer("resource_pk").notNull(),
  workspacePk: integer("workspace_pk").notNull(),
  bucketStart: integer("bucket_start").notNull(),
  bucketSeconds: integer("bucket_seconds").notNull(),
  state: text("state", {
    enum: ["healthy", "degraded", "down", "maintenance", "unknown"],
  }).notNull(),
  availabilityPermille: integer("availability_permille").notNull(),
  latencyAvgMs: integer("latency_avg_ms"),
  latencyMaxMs: integer("latency_max_ms"),
  summaryCode: text("summary_code").notNull(),
});
