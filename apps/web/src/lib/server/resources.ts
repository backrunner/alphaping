import { error } from "@sveltejs/kit";

import {
  loadMonitoringAccess,
  requireAdmin,
  requireResourceCapability,
} from "./monitoring-access.js";
import { prepareAuditStatement } from "./workspace-admin.js";

interface SequenceRow {
  value: number;
}

interface MachineConfigurationRow {
  name: string;
  description: string;
  expected_host: string | null;
  labels_json: string;
  sampling_interval_seconds: number;
  report_interval_seconds: number;
  offline_after_seconds: number;
  container_monitoring_enabled: number;
  maintenance_until: number | null;
  desired_config_revision: number;
}

interface EnrollmentTokenRow {
  id: string;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export interface EnrollmentTokenSummary {
  id: string;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  state: "active" | "used" | "revoked" | "expired";
}

export interface DeletedResourceSummary {
  type: "machine" | "service";
  id: string;
  name: string;
  deletedAt: number;
}

export interface MachineConfigurationInput {
  name: string;
  expectedHost: string;
  description: string;
  labels: string;
  samplingIntervalSeconds: number;
  reportIntervalSeconds: number;
  offlineAfterSeconds: number;
  containersEnabled: boolean;
  maintenanceUntil: number | null;
}

interface NormalizedMachineConfiguration {
  name: string;
  expectedHost: string | null;
  description: string;
  labels: Readonly<Record<string, string>>;
  samplingIntervalSeconds: number;
  reportIntervalSeconds: number;
  offlineAfterSeconds: number;
  containersEnabled: boolean;
  maintenanceUntil: number | null;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeHexSecret(value: string): ArrayBuffer {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw error(500, "Enrollment pepper is invalid");
  const buffer = new ArrayBuffer(32);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return buffer;
}

async function tokenDigest(token: string, pepper: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeHexSecret(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
}

async function enrollmentMaterial(pepper: string) {
  const token = randomToken();
  return {
    token,
    tokenId: crypto.randomUUID(),
    digest: await tokenDigest(token, pepper),
  };
}

async function nextSequence(db: D1Database, kind: "machine") {
  const row = await db
    .prepare(
      `UPDATE telemetry_resource_sequences SET value = value + 1
       WHERE kind = ? RETURNING value`,
    )
    .bind(kind)
    .first<SequenceRow>();
  if (!row) throw error(500, "Resource sequence is unavailable");
  return row.value;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw error(400, `${name} must be between ${minimum} and ${maximum} seconds`);
  }
  return value;
}

export function parseMachineLabels(value: string): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  const entries = value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > 20) throw error(400, "A machine can have at most 20 labels");
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw error(400, "Labels must use key=value format");
    const key = entry.slice(0, separator).trim();
    const labelValue = entry.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(key)) {
      throw error(400, `Label key ${key || "(empty)"} is invalid`);
    }
    if (labelValue.length === 0 || labelValue.length > 128) {
      throw error(400, `Label ${key} must have a value of at most 128 characters`);
    }
    if (Object.hasOwn(labels, key)) throw error(400, `Label ${key} is duplicated`);
    labels[key] = labelValue;
  }
  if (new TextEncoder().encode(JSON.stringify(labels)).byteLength > 4_096) {
    throw error(400, "Machine labels exceed the 4 KiB limit");
  }
  return labels;
}

export function normalizeMachineConfiguration(
  input: MachineConfigurationInput,
): NormalizedMachineConfiguration {
  const name = input.name.trim();
  const expectedHost = input.expectedHost.trim();
  const description = input.description.trim();
  if (name.length < 2 || name.length > 80) throw error(400, "Machine name is invalid");
  if (expectedHost.length > 253) throw error(400, "Expected host is invalid");
  if (description.length > 500) throw error(400, "Description is too long");
  const samplingIntervalSeconds = boundedInteger(
    input.samplingIntervalSeconds,
    "Sampling interval",
    5,
    300,
  );
  const reportIntervalSeconds = boundedInteger(
    input.reportIntervalSeconds,
    "Report interval",
    60,
    900,
  );
  const offlineAfterSeconds = boundedInteger(
    input.offlineAfterSeconds,
    "Offline threshold",
    60,
    86_400,
  );
  if (reportIntervalSeconds % samplingIntervalSeconds !== 0) {
    throw error(400, "Report interval must be divisible by the sampling interval");
  }
  if (offlineAfterSeconds < reportIntervalSeconds) {
    throw error(400, "Offline threshold cannot be shorter than the report interval");
  }
  if (
    input.maintenanceUntil !== null &&
    (!Number.isInteger(input.maintenanceUntil) || input.maintenanceUntil < 0)
  ) {
    throw error(400, "Maintenance end time is invalid");
  }
  return {
    name,
    expectedHost: expectedHost || null,
    description,
    labels: parseMachineLabels(input.labels),
    samplingIntervalSeconds,
    reportIntervalSeconds,
    offlineAfterSeconds,
    containersEnabled: input.containersEnabled,
    maintenanceUntil: input.maintenanceUntil,
  };
}

function auditConfiguration(configuration: NormalizedMachineConfiguration, revision: number) {
  return { ...configuration, desiredConfigRevision: revision };
}

export async function createMachine(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  enrollmentPepper: string,
  input: MachineConfigurationInput,
): Promise<{ token: string; tokenId: string; machineId: string; expiresAt: number }> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const configuration = normalizeMachineConfiguration(input);
  const telemetryPk = await nextSequence(db, "machine");
  const enrollment = await enrollmentMaterial(enrollmentPepper);
  const now = Date.now();
  const expiresAt = now + 15 * 60_000;
  const machineId = crypto.randomUUID();
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "machine.create",
    resourceType: "machine",
    resourceId: machineId,
    before: null,
    after: auditConfiguration(configuration, 1),
    now,
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO machines
          (id, telemetry_pk, workspace_id, name, description, expected_host, labels_json,
           sampling_interval_seconds, report_interval_seconds, offline_after_seconds,
           container_monitoring_enabled, maintenance_until, desired_config_revision,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        machineId,
        telemetryPk,
        access.workspaceId,
        configuration.name,
        configuration.description,
        configuration.expectedHost,
        JSON.stringify(configuration.labels),
        configuration.samplingIntervalSeconds,
        configuration.reportIntervalSeconds,
        configuration.offlineAfterSeconds,
        configuration.containersEnabled ? 1 : 0,
        configuration.maintenanceUntil,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO agent_enrollment_tokens
          (id, workspace_id, machine_id, token_digest, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        enrollment.tokenId,
        access.workspaceId,
        machineId,
        enrollment.digest,
        expiresAt,
        userId,
        now,
      ),
    db
      .prepare(
        `INSERT INTO dashboard_resources
          (dashboard_id, resource_type, resource_id, sort_order, public_override)
         VALUES (?, 'machine', ?, ?, 'inherit')`,
      )
      .bind(access.defaultDashboardId, machineId, telemetryPk),
    db
      .prepare(
        `INSERT INTO resource_public_policies
          (workspace_id, resource_type, resource_id, effect, projection_profile, updated_at)
         VALUES (?, 'machine', ?, 'deny', 'summary', ?)`,
      )
      .bind(access.workspaceId, machineId, now),
    audit,
  ]);
  return { token: enrollment.token, tokenId: enrollment.tokenId, machineId, expiresAt };
}

function rowConfiguration(row: MachineConfigurationRow): NormalizedMachineConfiguration {
  return {
    name: row.name,
    description: row.description,
    expectedHost: row.expected_host,
    labels: JSON.parse(row.labels_json) as Record<string, string>,
    samplingIntervalSeconds: row.sampling_interval_seconds,
    reportIntervalSeconds: row.report_interval_seconds,
    offlineAfterSeconds: row.offline_after_seconds,
    containersEnabled: row.container_monitoring_enabled === 1,
    maintenanceUntil: row.maintenance_until,
  };
}

export async function updateMachineConfiguration(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
  input: MachineConfigurationInput,
): Promise<{ revision: number }> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireResourceCapability(access, "machine", machineId, "manage");
  const existing = await db
    .prepare(
      `SELECT name, description, expected_host, labels_json, sampling_interval_seconds,
              report_interval_seconds, offline_after_seconds, container_monitoring_enabled,
              maintenance_until, desired_config_revision
       FROM machines WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(machineId, access.workspaceId)
    .first<MachineConfigurationRow>();
  if (!existing) throw error(404, "Resource not found");
  const configuration = normalizeMachineConfiguration(input);
  const revision = existing.desired_config_revision + 1;
  const now = Date.now();
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "machine.configuration.update",
    resourceType: "machine",
    resourceId: machineId,
    before: auditConfiguration(rowConfiguration(existing), existing.desired_config_revision),
    after: auditConfiguration(configuration, revision),
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE machines SET name = ?, description = ?, expected_host = ?, labels_json = ?,
            sampling_interval_seconds = ?, report_interval_seconds = ?, offline_after_seconds = ?,
            container_monitoring_enabled = ?, maintenance_until = ?,
            desired_config_revision = desired_config_revision + 1, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
           AND desired_config_revision = ?`,
      )
      .bind(
        configuration.name,
        configuration.description,
        configuration.expectedHost,
        JSON.stringify(configuration.labels),
        configuration.samplingIntervalSeconds,
        configuration.reportIntervalSeconds,
        configuration.offlineAfterSeconds,
        configuration.containersEnabled ? 1 : 0,
        configuration.maintenanceUntil,
        now,
        machineId,
        access.workspaceId,
        existing.desired_config_revision,
      ),
    audit,
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Machine configuration changed; reload and try again");
  }
  return { revision };
}

async function requireAdminMachine(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
) {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const machine = await db
    .prepare(`SELECT id FROM machines WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
    .bind(machineId, access.workspaceId)
    .first<{ id: string }>();
  if (!machine) throw error(404, "Resource not found");
  return access;
}

function enrollmentTokenSummary(row: EnrollmentTokenRow, now: number): EnrollmentTokenSummary {
  return {
    id: row.id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    state:
      row.used_at !== null
        ? "used"
        : row.revoked_at !== null
          ? "revoked"
          : row.expires_at <= now
            ? "expired"
            : "active",
  };
}

export async function listMachineEnrollmentTokens(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
): Promise<readonly EnrollmentTokenSummary[]> {
  const access = await requireAdminMachine(db, workspaceSlug, userId, machineId);
  const tokens = await db
    .prepare(
      `SELECT id, expires_at, used_at, revoked_at, created_at
       FROM agent_enrollment_tokens
       WHERE workspace_id = ? AND machine_id = ?
       ORDER BY created_at DESC LIMIT 20`,
    )
    .bind(access.workspaceId, machineId)
    .all<EnrollmentTokenRow>();
  const now = Date.now();
  return tokens.results.map((token) => enrollmentTokenSummary(token, now));
}

export async function revokeMachineEnrollmentToken(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
  tokenId: string,
): Promise<void> {
  const access = await requireAdminMachine(db, workspaceSlug, userId, machineId);
  const token = await db
    .prepare(
      `SELECT id, expires_at, used_at, revoked_at, created_at
       FROM agent_enrollment_tokens
       WHERE id = ? AND workspace_id = ? AND machine_id = ?`,
    )
    .bind(tokenId, access.workspaceId, machineId)
    .first<EnrollmentTokenRow>();
  if (!token) throw error(404, "Resource not found");
  if (token.used_at !== null || token.revoked_at !== null) {
    throw error(409, "Enrollment token is no longer revocable");
  }
  const now = Date.now();
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "agent.enrollment.revoke",
    resourceType: "machine",
    resourceId: machineId,
    before: enrollmentTokenSummary(token, now),
    after: { ...enrollmentTokenSummary(token, now), revokedAt: now, state: "revoked" },
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE agent_enrollment_tokens SET revoked_at = ?
         WHERE id = ? AND workspace_id = ? AND machine_id = ?
           AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(now, tokenId, access.workspaceId, machineId),
    audit,
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Enrollment token is no longer revocable");
  }
}

export async function regenerateMachineEnrollmentToken(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  enrollmentPepper: string,
  machineId: string,
): Promise<{ token: string; tokenId: string; machineId: string; expiresAt: number }> {
  const access = await requireAdminMachine(db, workspaceSlug, userId, machineId);
  const previous = await db
    .prepare(
      `SELECT id, expires_at, used_at, revoked_at, created_at
       FROM agent_enrollment_tokens
       WHERE workspace_id = ? AND machine_id = ? AND used_at IS NULL AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 20`,
    )
    .bind(access.workspaceId, machineId)
    .all<EnrollmentTokenRow>();
  const enrollment = await enrollmentMaterial(enrollmentPepper);
  const now = Date.now();
  const expiresAt = now + 15 * 60_000;
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "agent.enrollment.regenerate",
    resourceType: "machine",
    resourceId: machineId,
    before: { replacedTokenIds: previous.results.map((token) => token.id) },
    after: { tokenId: enrollment.tokenId, expiresAt },
    now,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE agent_enrollment_tokens SET revoked_at = ?
         WHERE workspace_id = ? AND machine_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(now, access.workspaceId, machineId),
    db
      .prepare(
        `INSERT INTO agent_enrollment_tokens
          (id, workspace_id, machine_id, token_digest, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        enrollment.tokenId,
        access.workspaceId,
        machineId,
        enrollment.digest,
        expiresAt,
        userId,
        now,
      ),
    audit,
  ]);
  return { token: enrollment.token, tokenId: enrollment.tokenId, machineId, expiresAt };
}

type ManagedResourceType = "machine" | "service";

function resourceTable(type: ManagedResourceType): "machines" | "services" {
  return type === "machine" ? "machines" : "services";
}

function advanceServiceAgentConfigurationsStatement(
  db: D1Database,
  workspaceId: string,
  serviceId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE machines SET desired_config_revision = desired_config_revision + 1, updated_at = ?
       WHERE changes() = 1 AND workspace_id = ? AND deleted_at IS NULL AND id IN (
         SELECT a.machine_id FROM check_configs c
         JOIN agents a ON a.id = c.executor_agent_id AND a.status = 'active'
         WHERE c.workspace_id = ? AND c.service_id = ? AND c.executor_kind = 'agent'
           AND c.enabled = 1
       )`,
    )
    .bind(now, workspaceId, workspaceId, serviceId);
}

export async function softDeleteResource(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  type: ManagedResourceType,
  resourceId: string,
): Promise<void> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireResourceCapability(access, type, resourceId, "manage");
  const table = resourceTable(type);
  const resource = await db
    .prepare(
      `SELECT id, name, deleted_at FROM ${table}
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(resourceId, access.workspaceId)
    .first<{ id: string; name: string; deleted_at: number | null }>();
  if (!resource || resource.deleted_at !== null) throw error(404, "Resource not found");
  const now = Date.now();
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: `${type}.delete`,
    resourceType: type,
    resourceId,
    before: { name: resource.name, deletedAt: null },
    after: { name: resource.name, deletedAt: now },
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      )
      .bind(now, now, resourceId, access.workspaceId),
    audit,
    ...(type === "service"
      ? [advanceServiceAgentConfigurationsStatement(db, access.workspaceId, resourceId, now)]
      : []),
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Resource state changed; reload and try again");
  }
}

export async function listDeletedResources(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<readonly DeletedResourceSummary[]> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const rows = await db
    .prepare(
      `SELECT 'machine' AS type, id, name, deleted_at FROM machines
       WHERE workspace_id = ? AND deleted_at IS NOT NULL
       UNION ALL
       SELECT 'service' AS type, id, name, deleted_at FROM services
       WHERE workspace_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC LIMIT 100`,
    )
    .bind(access.workspaceId, access.workspaceId)
    .all<{ type: "machine" | "service"; id: string; name: string; deleted_at: number }>();
  return rows.results.map((row) => ({
    type: row.type,
    id: row.id,
    name: row.name,
    deletedAt: row.deleted_at,
  }));
}

export async function restoreResource(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  type: ManagedResourceType,
  resourceId: string,
): Promise<void> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const table = resourceTable(type);
  const [resource, policy] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, deleted_at, purge_started_at FROM ${table}
         WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL`,
      )
      .bind(resourceId, access.workspaceId)
      .first<{ id: string; name: string; deleted_at: number; purge_started_at: number | null }>(),
    db
      .prepare(`SELECT soft_delete_grace_days FROM retention_policies WHERE workspace_id = ?`)
      .bind(access.workspaceId)
      .first<{ soft_delete_grace_days: number }>(),
  ]);
  if (!resource) throw error(404, "Resource not found");
  const graceDays = policy?.soft_delete_grace_days ?? 7;
  const now = Date.now();
  if (resource.deleted_at <= now - graceDays * 86_400_000) {
    throw error(409, "The resource recovery window has expired");
  }
  if (resource.purge_started_at !== null) {
    throw error(409, "The resource recovery window has expired");
  }
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: `${type}.restore`,
    resourceType: type,
    resourceId,
    before: { name: resource.name, deletedAt: resource.deleted_at },
    after: { name: resource.name, deletedAt: null },
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE ${table} SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND deleted_at = ? AND purge_started_at IS NULL`,
      )
      .bind(now, resourceId, access.workspaceId, resource.deleted_at),
    audit,
    ...(type === "service"
      ? [advanceServiceAgentConfigurationsStatement(db, access.workspaceId, resourceId, now)]
      : []),
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Resource state changed; reload and try again");
  }
}
