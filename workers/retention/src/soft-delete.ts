import {
  deleteWorkspaceTelemetryState,
  purgeMachineTelemetry,
  purgeServiceTelemetry,
  workspaceTelemetryIsEmpty,
} from "./soft-delete-telemetry";

const DAY_MS = 86_400_000;
const RESOURCE_BATCH = 10;
const CONTROL_ONLY_BATCH = 50;
const MAX_RELATED_RESOURCES = 500;
const ROW_BATCH = 200;

export interface SoftDeletePolicy {
  workspace_id: string;
  workspace_pk: number;
  workspace_deleted_at: number | null;
  soft_delete_grace_days: number;
}

interface ResourceRow {
  id: string;
  telemetry_pk: number;
}

interface AgentRow {
  id: string;
}

interface CheckRow {
  telemetry_pk: number;
  secret_refs_json: string;
}

interface IdRow {
  id: string;
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function effectiveDeletionBindings(
  policy: SoftDeletePolicy,
  cutoff: number,
): [number | null, number] {
  return [policy.workspace_deleted_at, cutoff];
}

async function deletedResources(
  db: D1Database,
  table: "machines" | "services",
  policy: SoftDeletePolicy,
  cutoff: number,
): Promise<readonly ResourceRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, telemetry_pk FROM ${table}
       WHERE workspace_id = ? AND COALESCE(deleted_at, ?) <= ?
       ORDER BY telemetry_pk LIMIT ?`,
    )
    .bind(policy.workspace_id, ...effectiveDeletionBindings(policy, cutoff), RESOURCE_BATCH)
    .all<ResourceRow>();
  return rows.results;
}

function statementChanges(results: readonly D1Result[]): number {
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

async function finalizeMachineControl(
  db: D1Database,
  policy: SoftDeletePolicy,
  machine: ResourceRow,
  cutoff: number,
): Promise<number> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE check_configs SET enabled = 0, executor_agent_id = NULL
         WHERE executor_agent_id IN (SELECT id FROM agents WHERE machine_id = ?)`,
      )
      .bind(machine.id),
    db
      .prepare(
        `DELETE FROM resource_grants WHERE workspace_id = ? AND (
           (resource_type = 'machine' AND resource_id = ?) OR
           (resource_type = 'container' AND resource_id IN (
             SELECT id FROM containers WHERE machine_id = ?
           ))
         )`,
      )
      .bind(policy.workspace_id, machine.id, machine.id),
    db
      .prepare(
        `DELETE FROM resource_public_policies WHERE workspace_id = ? AND (
           (resource_type = 'machine' AND resource_id = ?) OR
           (resource_type = 'container' AND resource_id IN (
             SELECT id FROM containers WHERE machine_id = ?
           ))
         )`,
      )
      .bind(policy.workspace_id, machine.id, machine.id),
    db
      .prepare(
        "DELETE FROM dashboard_resources WHERE resource_type = 'machine' AND resource_id = ?",
      )
      .bind(machine.id),
    db
      .prepare("DELETE FROM incident_resources WHERE resource_type = 'machine' AND resource_id = ?")
      .bind(machine.id),
    db
      .prepare(
        `DELETE FROM machines WHERE id = ? AND workspace_id = ?
         AND COALESCE(deleted_at, ?) <= ?`,
      )
      .bind(machine.id, policy.workspace_id, policy.workspace_deleted_at, cutoff),
  ]);
  return statementChanges(results);
}

async function finalizeMachines(
  env: Env,
  policy: SoftDeletePolicy,
  cutoff: number,
): Promise<number> {
  let deleted = 0;
  for (const machine of await deletedResources(env.CONTROL_DB, "machines", policy, cutoff)) {
    const agents = await env.CONTROL_DB.prepare(
      "SELECT id FROM agents WHERE machine_id = ? ORDER BY created_at LIMIT ?",
    )
      .bind(machine.id, MAX_RELATED_RESOURCES + 1)
      .all<AgentRow>();
    if (agents.results.length > MAX_RELATED_RESOURCES) {
      throw new Error("soft_delete_agent_limit_exceeded");
    }
    const purge = await purgeMachineTelemetry(
      env.TELEMETRY_DB,
      machine.telemetry_pk,
      agents.results.map((agent) => agent.id),
      ROW_BATCH,
    );
    deleted += purge.deleted;
    if (purge.complete)
      deleted += await finalizeMachineControl(env.CONTROL_DB, policy, machine, cutoff);
  }
  return deleted;
}

function collectSecretIds(rows: readonly CheckRow[]): readonly string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.secret_refs_json);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    const headers = record.headers;
    if (typeof headers === "object" && headers !== null) {
      for (const value of Object.values(headers as Record<string, unknown>)) {
        if (typeof value === "string") ids.add(value);
      }
    }
    for (const key of ["body", "tcpPayload"] as const) {
      if (typeof record[key] === "string") ids.add(record[key]);
    }
  }
  return [...ids];
}

async function deleteSecrets(db: D1Database, workspaceId: string, ids: readonly string[]) {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += CONTROL_ONLY_BATCH) {
    const batch = ids.slice(offset, offset + CONTROL_ONLY_BATCH);
    const result = await db
      .prepare(
        `DELETE FROM check_secrets
         WHERE workspace_id = ? AND id IN (${placeholders(batch.length)})`,
      )
      .bind(workspaceId, ...batch)
      .run();
    deleted += result.meta.changes ?? 0;
  }
  return deleted;
}

async function finalizeServiceControl(
  db: D1Database,
  policy: SoftDeletePolicy,
  service: ResourceRow,
  checks: readonly CheckRow[],
  cutoff: number,
): Promise<number> {
  let deleted = await deleteSecrets(db, policy.workspace_id, collectSecretIds(checks));
  const results = await db.batch([
    db
      .prepare(
        "DELETE FROM dashboard_resources WHERE resource_type = 'service' AND resource_id = ?",
      )
      .bind(service.id),
    db
      .prepare(
        "DELETE FROM resource_grants WHERE workspace_id = ? AND resource_type = 'service' AND resource_id = ?",
      )
      .bind(policy.workspace_id, service.id),
    db
      .prepare(
        "DELETE FROM resource_public_policies WHERE workspace_id = ? AND resource_type = 'service' AND resource_id = ?",
      )
      .bind(policy.workspace_id, service.id),
    db
      .prepare("DELETE FROM incident_resources WHERE resource_type = 'service' AND resource_id = ?")
      .bind(service.id),
    db
      .prepare(
        `DELETE FROM services WHERE id = ? AND workspace_id = ?
         AND COALESCE(deleted_at, ?) <= ?`,
      )
      .bind(service.id, policy.workspace_id, policy.workspace_deleted_at, cutoff),
  ]);
  deleted += statementChanges(results);
  return deleted;
}

async function finalizeServices(
  env: Env,
  policy: SoftDeletePolicy,
  cutoff: number,
): Promise<number> {
  let deleted = 0;
  for (const service of await deletedResources(env.CONTROL_DB, "services", policy, cutoff)) {
    const checks = await env.CONTROL_DB.prepare(
      `SELECT telemetry_pk, secret_refs_json FROM check_configs
       WHERE service_id = ? ORDER BY telemetry_pk LIMIT ?`,
    )
      .bind(service.id, MAX_RELATED_RESOURCES + 1)
      .all<CheckRow>();
    if (checks.results.length > MAX_RELATED_RESOURCES) {
      throw new Error("soft_delete_check_limit_exceeded");
    }
    const purge = await purgeServiceTelemetry(
      env.TELEMETRY_DB,
      service.telemetry_pk,
      checks.results.map((check) => check.telemetry_pk),
      ROW_BATCH,
    );
    deleted += purge.deleted;
    if (purge.complete) {
      deleted += await finalizeServiceControl(
        env.CONTROL_DB,
        policy,
        service,
        checks.results,
        cutoff,
      );
    }
  }
  return deleted;
}

async function finalizeControlOnlyTable(
  db: D1Database,
  policy: SoftDeletePolicy,
  cutoff: number,
  table: "announcements" | "containers" | "dashboards" | "incidents",
  resourceType: "container" | "dashboard" | "incident" | null,
): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT id FROM ${table} WHERE workspace_id = ? AND COALESCE(deleted_at, ?) <= ?
       ORDER BY id LIMIT ?`,
    )
    .bind(policy.workspace_id, policy.workspace_deleted_at, cutoff, CONTROL_ONLY_BATCH)
    .all<IdRow>();
  const ids = rows.results.map((row) => row.id);
  if (ids.length === 0) return 0;
  const statements: D1PreparedStatement[] = [];
  if (resourceType !== null) {
    statements.push(
      db
        .prepare(
          `DELETE FROM resource_grants WHERE workspace_id = ? AND resource_type = ?
           AND resource_id IN (${placeholders(ids.length)})`,
        )
        .bind(policy.workspace_id, resourceType, ...ids),
    );
  }
  if (resourceType === "container") {
    statements.push(
      db
        .prepare(
          `DELETE FROM resource_public_policies WHERE workspace_id = ? AND resource_type = 'container'
           AND resource_id IN (${placeholders(ids.length)})`,
        )
        .bind(policy.workspace_id, ...ids),
    );
  }
  statements.push(
    db
      .prepare(
        `DELETE FROM ${table} WHERE workspace_id = ? AND COALESCE(deleted_at, ?) <= ?
         AND id IN (${placeholders(ids.length)})`,
      )
      .bind(policy.workspace_id, policy.workspace_deleted_at, cutoff, ...ids),
  );
  return statementChanges(await db.batch(statements));
}

export async function finalizeSoftDeletedResources(
  env: Env,
  policy: SoftDeletePolicy,
  now: number,
): Promise<number> {
  const cutoff = now - policy.soft_delete_grace_days * DAY_MS;
  let deleted = await finalizeMachines(env, policy, cutoff);
  deleted += await finalizeServices(env, policy, cutoff);
  deleted += await finalizeControlOnlyTable(
    env.CONTROL_DB,
    policy,
    cutoff,
    "containers",
    "container",
  );
  deleted += await finalizeControlOnlyTable(
    env.CONTROL_DB,
    policy,
    cutoff,
    "dashboards",
    "dashboard",
  );
  deleted += await finalizeControlOnlyTable(
    env.CONTROL_DB,
    policy,
    cutoff,
    "incidents",
    "incident",
  );
  deleted += await finalizeControlOnlyTable(env.CONTROL_DB, policy, cutoff, "announcements", null);
  return deleted;
}

export async function finalizeDeletedWorkspace(
  env: Env,
  policy: SoftDeletePolicy,
  now: number,
): Promise<number> {
  if (
    policy.workspace_deleted_at === null ||
    policy.workspace_deleted_at > now - policy.soft_delete_grace_days * DAY_MS
  ) {
    return 0;
  }
  const controlRows = await env.CONTROL_DB.prepare(
    `SELECT CASE WHEN
       EXISTS(SELECT 1 FROM machines WHERE workspace_id = ?) OR
       EXISTS(SELECT 1 FROM services WHERE workspace_id = ?) OR
       EXISTS(SELECT 1 FROM containers WHERE workspace_id = ?) OR
       EXISTS(SELECT 1 FROM dashboards WHERE workspace_id = ?) OR
       EXISTS(SELECT 1 FROM incidents WHERE workspace_id = ?) OR
       EXISTS(SELECT 1 FROM announcements WHERE workspace_id = ?)
     THEN 1 ELSE 0 END AS present`,
  )
    .bind(...Array.from({ length: 6 }, () => policy.workspace_id))
    .first<{ present: number }>();
  if (
    controlRows?.present === 1 ||
    !(await workspaceTelemetryIsEmpty(env.TELEMETRY_DB, policy.workspace_pk))
  ) {
    return 0;
  }
  let deleted = await deleteWorkspaceTelemetryState(env.TELEMETRY_DB, policy.workspace_pk);
  const result = await env.CONTROL_DB.prepare(
    "DELETE FROM workspaces WHERE id = ? AND deleted_at = ?",
  )
    .bind(policy.workspace_id, policy.workspace_deleted_at)
    .run();
  deleted += result.meta.changes ?? 0;
  return deleted;
}
