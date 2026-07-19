import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    telemetryPk: integer("telemetry_pk").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    defaultDashboardId: text("default_dashboard_id"),
    defaultSamplingIntervalSeconds: integer("default_sampling_interval_seconds")
      .notNull()
      .default(10),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    purgeStartedAt: integer("purge_started_at"),
  },
  (table) => [
    uniqueIndex("workspaces_telemetry_pk_uq").on(table.telemetryPk),
    uniqueIndex("workspaces_slug_uq").on(table.slug),
  ],
);

export const memberships = sqliteTable(
  "memberships",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    status: text("status", { enum: ["invited", "active", "suspended"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const workspaceInvitations = sqliteTable(
  "workspace_invitations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    tokenDigest: blob("token_digest", { mode: "buffer" }).notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    revokedAt: integer("revoked_at"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_invitations_token_uq").on(table.tokenDigest),
    index("workspace_invitations_expiry_idx").on(table.workspaceId, table.expiresAt),
  ],
);

export const dashboards = sqliteTable(
  "dashboards",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility", { enum: ["private", "authenticated", "public"] }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [uniqueIndex("dashboards_workspace_slug_uq").on(table.workspaceId, table.slug)],
);

export const dashboardResources = sqliteTable(
  "dashboard_resources",
  {
    dashboardId: text("dashboard_id").notNull(),
    resourceType: text("resource_type", { enum: ["machine", "service"] }).notNull(),
    resourceId: text("resource_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    publicOverride: text("public_override", { enum: ["inherit", "allow", "deny"] })
      .notNull()
      .default("inherit"),
  },
  (table) => [primaryKey({ columns: [table.dashboardId, table.resourceType, table.resourceId] })],
);

export const resourceGrants = sqliteTable(
  "resource_grants",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    subjectUserId: text("subject_user_id").notNull(),
    resourceType: text("resource_type", {
      enum: ["dashboard", "machine", "container", "service", "incident"],
    }).notNull(),
    resourceId: text("resource_id").notNull(),
    capability: text("capability", { enum: ["view", "manage"] }).notNull(),
    effect: text("effect", { enum: ["allow", "deny"] }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("resource_grants_subject_resource_uq").on(
      table.subjectUserId,
      table.resourceType,
      table.resourceId,
      table.capability,
    ),
    index("resource_grants_subject_idx").on(
      table.workspaceId,
      table.subjectUserId,
      table.resourceType,
    ),
  ],
);

export const resourcePublicPolicies = sqliteTable(
  "resource_public_policies",
  {
    workspaceId: text("workspace_id").notNull(),
    resourceType: text("resource_type", { enum: ["machine", "container", "service"] }).notNull(),
    resourceId: text("resource_id").notNull(),
    effect: text("effect", { enum: ["allow", "deny"] }).notNull(),
    projectionProfile: text("projection_profile", { enum: ["summary", "detailed"] }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.resourceType, table.resourceId] })],
);

export const retentionPolicies = sqliteTable("retention_policies", {
  workspaceId: text("workspace_id").primaryKey(),
  rawDays: integer("raw_days").notNull().default(7),
  rollup5mDays: integer("rollup_5m_days").notNull().default(30),
  rollup1hDays: integer("rollup_1h_days").notNull().default(365),
  eventDays: integer("event_days").notNull().default(365),
  auditLogDays: integer("audit_log_days").notNull().default(365),
  expiredAnnouncementGraceDays: integer("expired_announcement_grace_days").notNull().default(7),
  softDeleteGraceDays: integer("soft_delete_grace_days").notNull().default(7),
  updatedAt: integer("updated_at").notNull(),
});

export const checkSchedulerState = sqliteTable("check_scheduler_state", {
  singleton: integer("singleton").primaryKey().default(1),
  checkCursor: integer("check_cursor").notNull().default(0),
  machineCursor: integer("machine_cursor").notNull().default(0),
  leaseUntil: integer("lease_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    beforeDigest: text("before_digest"),
    afterDigest: text("after_digest"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("audit_logs_workspace_time_idx").on(table.workspaceId, table.createdAt)],
);

export const machines = sqliteTable(
  "machines",
  {
    id: text("id").primaryKey(),
    telemetryPk: integer("telemetry_pk").notNull(),
    workspaceId: text("workspace_id").notNull(),
    publicSlug: text("public_slug").notNull(),
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
    purgeStartedAt: integer("purge_started_at"),
    purgeAgentCursor: text("purge_agent_cursor").notNull().default(""),
  },
  (table) => [
    uniqueIndex("machines_telemetry_pk_uq").on(table.telemetryPk),
    uniqueIndex("machines_workspace_public_slug_uq").on(table.workspaceId, table.publicSlug),
  ],
);

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    machineId: text("machine_id").notNull(),
    identityPublicKey: blob("identity_public_key", { mode: "buffer" }).notNull(),
    platform: text("platform").notNull(),
    arch: text("arch").notNull(),
    agentVersion: text("agent_version").notNull(),
    protocolVersion: integer("protocol_version").notNull(),
    hostname: text("hostname").notNull().default(""),
    osName: text("os_name").notNull().default(""),
    osVersion: text("os_version").notNull().default(""),
    kernelVersion: text("kernel_version").notNull().default(""),
    status: text("status", { enum: ["active", "revoked"] }).notNull(),
    appliedConfigRevision: integer("applied_config_revision").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at"),
    revokedAt: integer("revoked_at"),
    authCooldownUntil: integer("auth_cooldown_until").notNull().default(0),
  },
  (table) => [
    index("agents_workspace_idx").on(table.workspaceId, table.status),
    index("agents_machine_history_idx").on(table.machineId, table.id),
  ],
);

export const agentCommands = sqliteTable(
  "agent_commands",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    type: text("type", {
      enum: ["refresh_config", "check_update", "install_version", "redetect_runtimes"],
    }).notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    state: text("state", {
      enum: ["pending", "delivered", "succeeded", "failed", "expired"],
    }).notNull(),
    notBefore: integer("not_before").notNull(),
    expiresAt: integer("expires_at").notNull(),
    attemptLimit: integer("attempt_limit").notNull().default(3),
    payloadSchemaVersion: integer("payload_schema_version").notNull().default(1),
    deliveryCount: integer("delivery_count").notNull().default(0),
    resultCode: text("result_code"),
    resultJson: text("result_json"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    deliveredAt: integer("delivered_at"),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("agent_commands_agent_state_idx").on(table.agentId, table.state, table.notBefore),
    index("agent_commands_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.state} IN ('pending', 'delivered')`),
    index("agent_commands_completion_idx")
      .on(table.completedAt)
      .where(sql`${table.completedAt} IS NOT NULL`),
  ],
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
    configRevision: integer("config_revision").notNull().default(1),
    assignmentRevision: integer("assignment_revision").notNull().default(0),
    configBytes: integer("config_bytes").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    phaseSeconds: integer("phase_seconds").notNull().default(0),
    timeoutMs: integer("timeout_ms").notNull().default(5_000),
    retryCount: integer("retry_count").notNull().default(0),
    critical: integer("critical", { mode: "boolean" }).notNull().default(true),
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
    index("check_configs_service_idx").on(table.workspaceId, table.serviceId, table.telemetryPk),
  ],
);

export const serviceStateSyncJobs = sqliteTable(
  "service_state_sync_jobs",
  {
    jobKey: text("job_key").primaryKey(),
    syncToken: text("sync_token").notNull(),
    workspaceId: text("workspace_id").notNull(),
    workspacePk: integer("workspace_pk").notNull(),
    serviceId: text("service_id").notNull(),
    servicePk: integer("service_pk").notNull(),
    checkId: text("check_id"),
    checkPk: integer("check_pk"),
    reasonCode: text("reason_code", {
      enum: ["check_configuration", "maintenance_window", "maintenance_window_ended"],
    }).notNull(),
    protectUntil: integer("protect_until").notNull(),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lastAttemptedAt: integer("last_attempted_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("service_state_sync_jobs_scan_idx").on(
      table.nextAttemptAt,
      table.lastAttemptedAt,
      table.jobKey,
    ),
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
    purgeStartedAt: integer("purge_started_at"),
    purgeCheckCursor: integer("purge_check_cursor").notNull().default(0),
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

export const notificationChannels = sqliteTable(
  "notification_channels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    provider: text("provider", {
      enum: ["resend", "smtp", "discord", "telegram", "slack", "bark"],
    }).notNull(),
    configCiphertext: blob("config_ciphertext", { mode: "buffer" }).notNull(),
    configNonce: blob("config_nonce", { mode: "buffer" }).notNull(),
    wrappingKeyId: text("wrapping_key_id").notNull().default("v1"),
    configSummaryJson: text("config_summary_json").notNull().default("{}"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("notification_channels_workspace_idx").on(
      table.workspaceId,
      table.enabled,
      table.provider,
      table.name,
      table.id,
    ),
  ],
);

export const notificationRules = sqliteTable(
  "notification_rules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    resourceType: text("resource_type", { enum: ["machine", "service"] }).notNull(),
    resourceId: text("resource_id").notNull(),
    dimension: text("dimension", {
      enum: ["availability", "resource", "recovery"],
    }).notNull(),
    channelId: text("channel_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("notification_rules_channel_resource_uq").on(
      table.channelId,
      table.resourceType,
      table.resourceId,
      table.dimension,
    ),
    index("notification_rules_resource_idx").on(
      table.workspaceId,
      table.resourceType,
      table.resourceId,
      table.dimension,
      table.enabled,
      table.channelId,
    ),
  ],
);

export const notificationEventCursors = sqliteTable("notification_event_cursors", {
  singleton: integer("singleton").primaryKey().default(1),
  lastOccurredAt: integer("last_occurred_at").notNull().default(0),
  lastEventId: blob("last_event_id", { mode: "buffer" }).notNull(),
  lastResourceType: integer("last_resource_type").notNull().default(0),
  lastResourcePk: integer("last_resource_pk").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    channelId: text("channel_id").notNull(),
    sourceWorkspacePk: integer("source_workspace_pk").notNull(),
    sourceResourceType: integer("source_resource_type").notNull(),
    sourceResourcePk: integer("source_resource_pk").notNull(),
    sourceOccurredAt: integer("source_occurred_at").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    dimension: text("dimension", {
      enum: ["availability", "resource", "recovery"],
    }).notNull(),
    payloadJson: text("payload_json").notNull(),
    state: text("state", { enum: ["pending", "delivering", "sent", "dead"] })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    claimToken: text("claim_token"),
    claimUntil: integer("claim_until"),
    lastError: text("last_error"),
    responseStatus: integer("response_status"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (table) => [
    uniqueIndex("notification_deliveries_source_channel_uq").on(
      table.channelId,
      table.sourceWorkspacePk,
      table.sourceResourceType,
      table.sourceResourcePk,
      table.sourceOccurredAt,
      table.sourceEventId,
    ),
    index("notification_deliveries_claim_idx").on(
      table.state,
      table.nextAttemptAt,
      table.claimUntil,
      table.createdAt,
      table.id,
    ),
    index("notification_deliveries_workspace_idx").on(table.workspaceId, table.createdAt, table.id),
  ],
);
