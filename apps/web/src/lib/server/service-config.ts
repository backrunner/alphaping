import { error } from "@sveltejs/kit";

import { compileServiceConfig, type CreateServiceMonitorInput } from "./service-config-compiler.js";
import {
  loadMonitoringAccess,
  requireAdmin,
  requireResourceCapability,
} from "./monitoring-access.js";
import { prepareAuditStatement } from "./workspace-admin.js";

export type {
  CreateServiceMonitorInput,
  ServiceAssertionInput,
} from "./service-config-compiler.js";

interface SequenceRow {
  value: number;
}
interface AgentRow {
  id: string;
  machine_id: string;
  probe_count: number;
  config_bytes: number;
}
interface RevisionRow {
  revision: number;
}

async function nextSequence(db: D1Database, kind: "service" | "check"): Promise<number> {
  const row = await db
    .prepare(
      `UPDATE telemetry_resource_sequences SET value = value + 1 WHERE kind = ? RETURNING value`,
    )
    .bind(kind)
    .first<SequenceRow>();
  if (!row) throw error(500, "Resource sequence is unavailable");
  return row.value;
}

function slugBase(name: string): string {
  const normalized = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return normalized || "service";
}

async function availableSlug(db: D1Database, workspaceId: string, name: string): Promise<string> {
  const base = slugBase(name);
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const existing = await db
      .prepare(
        `SELECT 1 AS present FROM services
       WHERE workspace_id = ? AND slug = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .bind(workspaceId, slug)
      .first<{ present: number }>();
    if (!existing) return slug;
  }
  throw error(409, "A unique service slug could not be generated");
}

export async function createServiceMonitor(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  wrappingKey: string,
  input: CreateServiceMonitorInput,
): Promise<{ serviceId: string }> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const agent =
    input.executorKind === "agent"
      ? await db
          .prepare(
            `SELECT a.id, a.machine_id,
                    (SELECT COUNT(*) FROM check_configs c
                     WHERE c.executor_agent_id = a.id AND c.enabled = 1) AS probe_count,
                    (SELECT COALESCE(SUM(c.config_bytes), 0) FROM check_configs c
                     WHERE c.executor_agent_id = a.id AND c.enabled = 1) AS config_bytes
             FROM agents a
             WHERE a.id = ? AND a.workspace_id = ? AND a.status = 'active'`,
          )
          .bind(input.executorAgentId, access.workspaceId)
          .first<AgentRow>()
      : null;
  if (input.executorKind === "agent" && !agent) {
    throw error(400, "A valid Agent executor is required");
  }
  if (agent && agent.probe_count >= 32) {
    throw error(409, "An Agent can run at most 32 enabled checks");
  }
  const compiled = await compileServiceConfig(input, access.workspaceId, wrappingKey);
  const configBytes =
    new TextEncoder().encode(JSON.stringify(compiled.request)).byteLength +
    compiled.secrets.reduce((total, secret) => total + secret.wrappedValue.byteLength, 0) +
    512;
  if (agent && agent.config_bytes + configBytes > 44 * 1024) {
    throw error(409, "The Agent configuration has reached its encrypted snapshot size limit");
  }
  const [servicePk, checkPk, slug] = await Promise.all([
    nextSequence(db, "service"),
    nextSequence(db, "check"),
    availableSlug(db, access.workspaceId, input.name),
  ]);
  const serviceId = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  const now = Date.now();
  const assignmentRevision = agent
    ? await db
        .prepare(
          `UPDATE machines
           SET desired_config_revision = desired_config_revision + 1, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
           RETURNING desired_config_revision AS revision`,
        )
        .bind(now, agent.machine_id, access.workspaceId)
        .first<RevisionRow>()
    : { revision: 0 };
  if (!assignmentRevision) {
    throw error(409, "The Agent machine configuration could not be advanced");
  }
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO services
        (id, telemetry_pk, workspace_id, name, slug, description, status_rule_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        serviceId,
        servicePk,
        access.workspaceId,
        input.name,
        slug,
        input.description,
        JSON.stringify({
          failureConfirmations: input.failureConfirmations,
          recoveryConfirmations: input.recoveryConfirmations,
        }),
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO check_configs
        (id, telemetry_pk, workspace_id, service_id, name, kind, executor_kind,
         executor_agent_id, assignment_revision, enabled, interval_seconds, phase_seconds, timeout_ms,
         request_json, secret_refs_json, failure_confirmations, recovery_confirmations,
         config_bytes, last_claimed_slot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(
        checkId,
        checkPk,
        access.workspaceId,
        serviceId,
        `${input.name} availability`,
        input.kind,
        input.executorKind,
        input.executorKind === "agent" ? input.executorAgentId : null,
        assignmentRevision.revision,
        input.intervalSeconds,
        checkPk % input.intervalSeconds,
        input.timeoutMs,
        JSON.stringify(compiled.request),
        JSON.stringify(compiled.secretRefs),
        input.failureConfirmations,
        input.recoveryConfirmations,
        configBytes,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO dashboard_resources
        (dashboard_id, resource_type, resource_id, sort_order, public_override)
       VALUES (?, 'service', ?, ?, 'inherit')`,
      )
      .bind(access.defaultDashboardId, serviceId, servicePk),
    db
      .prepare(
        `INSERT INTO resource_public_policies
        (workspace_id, resource_type, resource_id, effect, projection_profile, updated_at)
       VALUES (?, 'service', ?, 'deny', 'summary', ?)`,
      )
      .bind(access.workspaceId, serviceId, now),
  ];
  for (const [index, assertion] of compiled.assertions.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO check_assertions
        (id, check_id, sort_order, source, operator, selector, expected_json, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          checkId,
          index,
          assertion.source,
          assertion.operator,
          assertion.selector,
          JSON.stringify(assertion.expected),
          assertion.severity,
          now,
        ),
    );
  }
  for (const secret of compiled.secrets) {
    statements.push(
      db
        .prepare(
          `INSERT INTO check_secrets
        (id, workspace_id, name, wrapped_value, wrapping_key_id, nonce, created_at)
       VALUES (?, ?, ?, ?, 'v1', ?, ?)`,
        )
        .bind(secret.id, access.workspaceId, secret.name, secret.wrappedValue, secret.nonce, now),
    );
  }
  await db.batch(statements);
  return { serviceId };
}

export async function setServicePublicAccess(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  isPublic: boolean,
): Promise<void> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const service = await db
    .prepare(`SELECT id FROM services WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
    .bind(serviceId, access.workspaceId)
    .first<{ id: string }>();
  if (!service) throw error(404, "Service not found");
  const now = Date.now();
  const statements = [
    db
      .prepare(
        `INSERT INTO resource_public_policies
        (workspace_id, resource_type, resource_id, effect, projection_profile, updated_at)
       VALUES (?, 'service', ?, ?, 'detailed', ?)
       ON CONFLICT(workspace_id, resource_type, resource_id) DO UPDATE SET
         effect = excluded.effect, projection_profile = excluded.projection_profile,
         updated_at = excluded.updated_at`,
      )
      .bind(access.workspaceId, serviceId, isPublic ? "allow" : "deny", now),
    db
      .prepare(
        `INSERT INTO dashboard_resources
        (dashboard_id, resource_type, resource_id, sort_order, public_override)
       VALUES (?, 'service', ?, 0, ?)
       ON CONFLICT(dashboard_id, resource_type, resource_id) DO UPDATE SET
         public_override = excluded.public_override`,
      )
      .bind(access.defaultDashboardId, serviceId, isPublic ? "allow" : "deny"),
  ];
  if (isPublic) {
    statements.push(
      db
        .prepare(
          `UPDATE dashboards SET visibility = 'public', updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
        )
        .bind(now, access.defaultDashboardId, access.workspaceId),
    );
  }
  await db.batch(statements);
}

export async function setServiceMaintenance(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  maintenanceUntil: number | null,
): Promise<void> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const service = await db
    .prepare(
      `SELECT maintenance_until FROM services
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(serviceId, access.workspaceId)
    .first<{ maintenance_until: number | null }>();
  if (!service) throw error(404, "Service not found");
  if (maintenanceUntil !== null && (!Number.isInteger(maintenanceUntil) || maintenanceUntil < 0)) {
    throw error(400, "Maintenance end time is invalid");
  }
  const now = Date.now();
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "service.maintenance.update",
    resourceType: "service",
    resourceId: serviceId,
    before: { maintenanceUntil: service.maintenance_until },
    after: { maintenanceUntil },
    now,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE services SET maintenance_until = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      )
      .bind(maintenanceUntil, now, serviceId, access.workspaceId),
    audit,
  ]);
}
