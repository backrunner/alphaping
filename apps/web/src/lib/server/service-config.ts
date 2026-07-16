import { error } from "@sveltejs/kit";

import { compileServiceConfig, type CreateServiceMonitorInput } from "./service-config-compiler.js";
import {
  loadMonitoringAccess,
  requireAdmin,
  requireResourceCapability,
} from "./monitoring-access.js";

export type {
  CreateServiceMonitorInput,
  ServiceAssertionInput,
} from "./service-config-compiler.js";

interface SequenceRow {
  value: number;
}
interface AgentRow {
  id: string;
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
  if (input.executorKind === "agent") {
    const agent = await db
      .prepare(`SELECT id FROM agents WHERE id = ? AND workspace_id = ? AND status = 'active'`)
      .bind(input.executorAgentId, access.workspaceId)
      .first<AgentRow>();
    if (!agent) throw error(400, "A valid Agent executor is required");
  }
  const compiled = await compileServiceConfig(input, access.workspaceId, wrappingKey);
  const [servicePk, checkPk, slug] = await Promise.all([
    nextSequence(db, "service"),
    nextSequence(db, "check"),
    availableSlug(db, access.workspaceId, input.name),
  ]);
  const serviceId = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  const now = Date.now();
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
         executor_agent_id, enabled, interval_seconds, phase_seconds, timeout_ms,
         request_json, secret_refs_json, failure_confirmations, recovery_confirmations,
         last_claimed_slot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
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
        input.intervalSeconds,
        checkPk % input.intervalSeconds,
        input.timeoutMs,
        JSON.stringify(compiled.request),
        JSON.stringify(compiled.secretRefs),
        input.failureConfirmations,
        input.recoveryConfirmations,
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
