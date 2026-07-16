import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    containerCatalogDigest: blob("container_catalog_digest", { mode: "buffer" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [uniqueIndex("machines_telemetry_pk_uq").on(table.telemetryPk)],
);

export const containers = sqliteTable(
  "containers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    machineId: text("machine_id").notNull(),
    runtime: text("runtime", {
      enum: ["docker", "colima-docker", "colima-containerd", "apple-container", "unknown"],
    }).notNull(),
    runtimeInstance: text("runtime_instance").notNull(),
    runtimeContainerId: text("runtime_container_id").notNull(),
    name: text("name").notNull(),
    image: text("image").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("containers_runtime_identity_uq").on(
      table.machineId,
      table.runtime,
      table.runtimeInstance,
      table.runtimeContainerId,
    ),
    index("containers_machine_idx").on(table.workspaceId, table.machineId, table.deletedAt),
  ],
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
    assignmentRevision: integer("assignment_revision").notNull().default(0),
    configBytes: integer("config_bytes").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    phaseSeconds: integer("phase_seconds").notNull().default(0),
    timeoutMs: integer("timeout_ms").notNull().default(5_000),
    requestJson: text("request_json").notNull(),
    failureConfirmations: integer("failure_confirmations").notNull().default(3),
    recoveryConfirmations: integer("recovery_confirmations").notNull().default(2),
    secretRefsJson: text("secret_refs_json").notNull().default("{}"),
    lastClaimedSlot: integer("last_claimed_slot").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("check_configs_telemetry_pk_uq").on(table.telemetryPk),
    index("check_configs_service_idx").on(table.workspaceId, table.serviceId),
  ],
);

export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    telemetryPk: integer("telemetry_pk").notNull(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug"),
    description: text("description").notNull().default(""),
    statusRuleJson: text("status_rule_json").notNull().default("{}"),
    maintenanceUntil: integer("maintenance_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("services_telemetry_pk_uq").on(table.telemetryPk),
    uniqueIndex("services_workspace_slug_uq").on(table.workspaceId, table.slug),
  ],
);

export const checkAssertions = sqliteTable(
  "check_assertions",
  {
    id: text("id").primaryKey(),
    checkId: text("check_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    source: text("source", {
      enum: ["status", "latency", "header", "jsonpath", "body"],
    }).notNull(),
    operator: text("operator", {
      enum: ["exists", "equals", "contains", "matches", "type", "greater_than", "less_than"],
    }).notNull(),
    selector: text("selector"),
    expectedJson: text("expected_json"),
    severity: text("severity", { enum: ["degraded", "down"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("check_assertions_order_uq").on(table.checkId, table.sortOrder)],
);

export const checkSecrets = sqliteTable(
  "check_secrets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    wrappedValue: blob("wrapped_value", { mode: "buffer" }).notNull(),
    wrappingKeyId: text("wrapping_key_id").notNull(),
    nonce: blob("nonce", { mode: "buffer" }).notNull(),
    createdAt: integer("created_at").notNull(),
    rotatedAt: integer("rotated_at"),
  },
  (table) => [index("check_secrets_workspace_idx").on(table.workspaceId, table.id)],
);
