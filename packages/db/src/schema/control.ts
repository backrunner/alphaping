import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    telemetryPk: integer("telemetry_pk").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("workspaces_telemetry_pk_uq").on(table.telemetryPk),
    uniqueIndex("workspaces_slug_uq").on(table.slug),
  ],
);

export const machines = sqliteTable(
  "machines",
  {
    id: text("id").primaryKey(),
    telemetryPk: integer("telemetry_pk").notNull(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    expectedHost: text("expected_host"),
    samplingIntervalSeconds: integer("sampling_interval_seconds").notNull().default(10),
    reportIntervalSeconds: integer("report_interval_seconds").notNull().default(60),
    offlineAfterSeconds: integer("offline_after_seconds").notNull().default(150),
    containerMonitoringEnabled: integer("container_monitoring_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    desiredConfigRevision: integer("desired_config_revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [uniqueIndex("machines_telemetry_pk_uq").on(table.telemetryPk)],
);

export const checkConfigs = sqliteTable(
  "check_configs",
  {
    id: text("id").primaryKey(),
    telemetryPk: integer("telemetry_pk").notNull(),
    workspaceId: text("workspace_id").notNull(),
    serviceId: text("service_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["http", "tcp", "icmp"] }).notNull(),
    executorKind: text("executor_kind", { enum: ["cloudflare", "agent"] }).notNull(),
    executorAgentId: text("executor_agent_id"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    phaseSeconds: integer("phase_seconds").notNull().default(0),
    timeoutMs: integer("timeout_ms").notNull().default(5_000),
    requestJson: text("request_json").notNull(),
    lastClaimedSlot: integer("last_claimed_slot").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("check_configs_telemetry_pk_uq").on(table.telemetryPk)],
);
