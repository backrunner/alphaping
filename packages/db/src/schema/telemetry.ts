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
  observedAt: integer("observed_at").notNull(),
  state: text("state").notNull(),
  latencyMs: integer("latency_ms"),
  failureCode: text("failure_code"),
  resultId: blob("result_id", { mode: "buffer" }).notNull(),
});
