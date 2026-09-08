import {
  blob,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const stateEvents = sqliteTable(
  "state_events",
  {
    workspacePk: integer("workspace_pk").notNull(),
    resourceType: integer("resource_type").notNull(),
    resourcePk: integer("resource_pk").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    eventId: blob("event_id", { mode: "buffer" }).notNull(),
    previousState: text("previous_state").notNull(),
    currentState: text("current_state").notNull(),
    reasonCode: text("reason_code").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.resourceType, table.resourcePk, table.occurredAt, table.eventId],
    }),
  ],
);

export const notificationEventQueue = sqliteTable(
  "notification_event_queue",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    workspacePk: integer("workspace_pk").notNull(),
    resourceType: integer("resource_type").notNull(),
    resourcePk: integer("resource_pk").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    eventId: blob("event_id", { mode: "buffer" }).notNull(),
  },
  (table) => [
    uniqueIndex("notification_event_queue_source_uq").on(
      table.resourceType,
      table.resourcePk,
      table.occurredAt,
      table.eventId,
    ),
    foreignKey({
      columns: [table.resourceType, table.resourcePk, table.occurredAt, table.eventId],
      foreignColumns: [
        stateEvents.resourceType,
        stateEvents.resourcePk,
        stateEvents.occurredAt,
        stateEvents.eventId,
      ],
    }).onDelete("cascade"),
  ],
);

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
  load1mMilli: integer("load_1m_milli"),
  uptimeSeconds: integer("uptime_seconds"),
  reportId: blob("report_id", { mode: "buffer" }).notNull(),
  containerInventoryJson: text("container_inventory_json"),
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
  critical: integer("critical", { mode: "boolean" }).notNull().default(true),
  configRevision: integer("config_revision").notNull().default(0),
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
