import {
  deleteWorkspaceTelemetryState,
  purgeMachineTelemetry,
  purgeServiceTelemetry,
  workspaceTelemetryIsEmpty,
} from "./soft-delete-telemetry";

const DAY_MS = 86_400_000;
const RESOURCE_BATCH = 10;
const CONTROL_ONLY_BATCH = 50;
const RELATED_RESOURCE_BATCH = 50;
const SECRET_BATCH = 40;
const ROW_BATCH = 200;

export interface SoftDeletePolicy {
  workspace_id: string;
  workspace_pk: number;
  workspace_deleted_at: number | null;
  workspace_purge_started_at: number | null;
  soft_delete_grace_days: number;
}

interface ResourceRow {
  id: string;
  telemetry_pk: number;
  deleted_at: number | null;
}

interface RelatedResourceRow<T extends number | string> extends ResourceRow {
  related_cursor: T;
}

interface PurgeClaimRow {
  purge_started_at: number;
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

async function claimWorkspaceFinalization(
  db: D1Database,
  policy: SoftDeletePolicy,
  cutoff: number,
  now: number,
): Promise<boolean> {
  if (policy.workspace_deleted_at === null || policy.workspace_deleted_at > cutoff) return true;
  const claim = await db
    .prepare(
      `UPDATE workspaces SET purge_started_at = COALESCE(purge_started_at, ?)
       WHERE id = ? AND deleted_at = ? AND deleted_at <= ?
       RETURNING purge_started_at`,
    )
    .bind(now, policy.workspace_id, policy.workspace_deleted_at, cutoff)
    .first<PurgeClaimRow>();
  return claim !== null;
}

async function claimResourceFinalization(
  db: D1Database,
  table: "machines" | "services",
  policy: SoftDeletePolicy,
  resource: ResourceRow,
  cutoff: number,
  now: number,
): Promise<boolean> {
  const base = `UPDATE ${table} SET purge_started_at = COALESCE(purge_started_at, ?)
                WHERE id = ? AND workspace_id = ?`;
  const statement =
    resource.deleted_at === null
      ? db
          .prepare(
            `${base} AND deleted_at IS NULL AND EXISTS (
               SELECT 1 FROM workspaces
               WHERE id = ? AND deleted_at = ? AND purge_started_at IS NOT NULL
             ) RETURNING purge_started_at`,
          )
          .bind(
            now,
            resource.id,
            policy.workspace_id,
            policy.workspace_id,
            policy.workspace_deleted_at,
          )
      : db
          .prepare(
            `${base} AND deleted_at = ? AND deleted_at <= ?
             RETURNING purge_started_at`,
          )
          .bind(now, resource.id, policy.workspace_id, resource.deleted_at, cutoff);
  return (await statement.first<PurgeClaimRow>()) !== null;
}

async function deletedResources(
  db: D1Database,
  table: "machines" | "services",
  cursorColumn: "purge_agent_cursor" | "purge_check_cursor",
  policy: SoftDeletePolicy,
  cutoff: number,
): Promise<readonly RelatedResourceRow<number | string>[]> {
  const rows = await db
    .prepare(
      `SELECT id, telemetry_pk, deleted_at, ${cursorColumn} AS related_cursor FROM ${table}
       WHERE workspace_id = ? AND COALESCE(deleted_at, ?) <= ?
       ORDER BY telemetry_pk LIMIT ?`,
    )
    .bind(policy.workspace_id, ...effectiveDeletionBindings(policy, cutoff), RESOURCE_BATCH)
    .all<RelatedResourceRow<number | string>>();
  return rows.results;
}

async function advanceRelatedCursor(
  db: D1Database,
  table: "machines" | "services",
  cursorColumn: "purge_agent_cursor" | "purge_check_cursor",
  policy: SoftDeletePolicy,
  resourceId: string,
  previousCursor: number | string,
  nextCursor: number | string,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE ${table} SET ${cursorColumn} = ?
       WHERE id = ? AND workspace_id = ? AND purge_started_at IS NOT NULL
         AND ${cursorColumn} = ?`,
    )
    .bind(nextCursor, resourceId, policy.workspace_id, previousCursor)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new Error("soft_delete_related_cursor_conflict");
}

async function loadAgentPage(
  db: D1Database,
  machineId: string,
  cursor: string,
): Promise<{ rows: readonly AgentRow[]; hasMore: boolean }> {
  const page = await db
    .prepare(
      `SELECT id FROM agents WHERE machine_id = ? AND id > ?
       ORDER BY id LIMIT ?`,
    )
    .bind(machineId, cursor, RELATED_RESOURCE_BATCH + 1)
    .all<AgentRow>();
  return {
    rows: page.results.slice(0, RELATED_RESOURCE_BATCH),
    hasMore: page.results.length > RELATED_RESOURCE_BATCH,
  };
}

async function assertAgentCursor(db: D1Database, machineId: string, cursor: string): Promise<void> {
  if (cursor === "") return;
  const row = await db
    .prepare("SELECT 1 AS present FROM agents WHERE id = ? AND machine_id = ?")
    .bind(cursor, machineId)
    .first<{ present: number }>();
  if (!row) throw new Error("soft_delete_agent_cursor_invalid");
}

async function loadCheckPage(
  db: D1Database,
  policy: SoftDeletePolicy,
  serviceId: string,
  cursor: number,
): Promise<{ rows: readonly CheckRow[]; hasMore: boolean }> {
  const page = await db
    .prepare(
      `SELECT telemetry_pk, secret_refs_json FROM check_configs
       WHERE workspace_id = ? AND service_id = ? AND telemetry_pk > ?
       ORDER BY telemetry_pk LIMIT ?`,
    )
    .bind(policy.workspace_id, serviceId, cursor, RELATED_RESOURCE_BATCH + 1)
    .all<CheckRow>();
  return {
    rows: page.results.slice(0, RELATED_RESOURCE_BATCH),
    hasMore: page.results.length > RELATED_RESOURCE_BATCH,
  };
}

async function assertCheckCursor(
  db: D1Database,
  policy: SoftDeletePolicy,
  serviceId: string,
  cursor: number,
): Promise<void> {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("soft_delete_check_cursor_invalid");
  }
  if (cursor === 0) return;
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM check_configs
       WHERE workspace_id = ? AND service_id = ? AND telemetry_pk = ?`,
    )
    .bind(policy.workspace_id, serviceId, cursor)
    .first<{ present: number }>();
  if (!row) throw new Error("soft_delete_check_cursor_invalid");
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
         AND purge_started_at IS NOT NULL AND COALESCE(deleted_at, ?) <= ?`,
      )
      .bind(machine.id, policy.workspace_id, policy.workspace_deleted_at, cutoff),
  ]);
  return statementChanges(results);
}

async function finalizeMachines(
  env: Env,
  policy: SoftDeletePolicy,
  cutoff: number,
  now: number,
): Promise<number> {
  let deleted = 0;
  for (const machine of await deletedResources(
    env.CONTROL_DB,
    "machines",
    "purge_agent_cursor",
    policy,
    cutoff,
  )) {
    if (
      !(await claimResourceFinalization(env.CONTROL_DB, "machines", policy, machine, cutoff, now))
    ) {
      continue;
    }
    const cursor = String(machine.related_cursor);
    await assertAgentCursor(env.CONTROL_DB, machine.id, cursor);
    const agents = await loadAgentPage(env.CONTROL_DB, machine.id, cursor);
    const purge = await purgeMachineTelemetry(
      env.TELEMETRY_DB,
      policy.workspace_pk,
      machine.telemetry_pk,
      agents.rows.map((agent) => agent.id),
      ROW_BATCH,
    );
    deleted += purge.deleted;
    if (!purge.complete) continue;
    if (agents.hasMore) {
      const nextCursor = agents.rows.at(-1)?.id;
      if (!nextCursor) throw new Error("soft_delete_agent_page_empty");
      await advanceRelatedCursor(
        env.CONTROL_DB,
        "machines",
        "purge_agent_cursor",
        policy,
        machine.id,
        cursor,
        nextCursor,
      );
      continue;
    }
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
  for (let offset = 0; offset < ids.length; offset += SECRET_BATCH) {
    const batch = ids.slice(offset, offset + SECRET_BATCH);
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
  cutoff: number,
): Promise<number> {
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
         AND purge_started_at IS NOT NULL AND COALESCE(deleted_at, ?) <= ?`,
      )
      .bind(service.id, policy.workspace_id, policy.workspace_deleted_at, cutoff),
  ]);
  return statementChanges(results);
}

async function finalizeServices(
  env: Env,
  policy: SoftDeletePolicy,
  cutoff: number,
  now: number,
): Promise<number> {
  let deleted = 0;
  for (const service of await deletedResources(
    env.CONTROL_DB,
    "services",
    "purge_check_cursor",
    policy,
    cutoff,
  )) {
    if (
      !(await claimResourceFinalization(env.CONTROL_DB, "services", policy, service, cutoff, now))
    ) {
      continue;
    }
    const cursor = Number(service.related_cursor);
    await assertCheckCursor(env.CONTROL_DB, policy, service.id, cursor);
    const checks = await loadCheckPage(env.CONTROL_DB, policy, service.id, cursor);
    const purge = await purgeServiceTelemetry(
      env.TELEMETRY_DB,
      policy.workspace_pk,
      service.telemetry_pk,
      checks.rows.map((check) => check.telemetry_pk),
      ROW_BATCH,
    );
    deleted += purge.deleted;
    if (!purge.complete) continue;
    deleted += await deleteSecrets(
      env.CONTROL_DB,
      policy.workspace_id,
      collectSecretIds(checks.rows),
    );
    if (checks.hasMore) {
      const nextCursor = checks.rows.at(-1)?.telemetry_pk;
      if (nextCursor === undefined) throw new Error("soft_delete_check_page_empty");
      await advanceRelatedCursor(
        env.CONTROL_DB,
        "services",
        "purge_check_cursor",
        policy,
        service.id,
        cursor,
        nextCursor,
      );
      continue;
    }
    deleted += await finalizeServiceControl(env.CONTROL_DB, policy, service, cutoff);
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
  const eligibleIds = `SELECT id FROM ${table}
                       WHERE workspace_id = ? AND COALESCE(deleted_at, ?) <= ?
                         AND id IN (${placeholders(ids.length)})`;
  const eligibleBindings = [policy.workspace_id, policy.workspace_deleted_at, cutoff, ...ids];
  const statements: D1PreparedStatement[] = [];
  if (resourceType !== null) {
    statements.push(
      db
        .prepare(
          `DELETE FROM resource_grants WHERE workspace_id = ? AND resource_type = ?
           AND resource_id IN (${eligibleIds})`,
        )
        .bind(policy.workspace_id, resourceType, ...eligibleBindings),
    );
  }
  if (resourceType === "container") {
    statements.push(
      db
        .prepare(
          `DELETE FROM resource_public_policies WHERE workspace_id = ? AND resource_type = 'container'
           AND resource_id IN (${eligibleIds})`,
        )
        .bind(policy.workspace_id, ...eligibleBindings),
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
  if (!(await claimWorkspaceFinalization(env.CONTROL_DB, policy, cutoff, now))) return 0;
  let deleted = await finalizeMachines(env, policy, cutoff, now);
  deleted += await finalizeServices(env, policy, cutoff, now);
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
  const cutoff = now - policy.soft_delete_grace_days * DAY_MS;
  if (!(await claimWorkspaceFinalization(env.CONTROL_DB, policy, cutoff, now))) return 0;
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
    "DELETE FROM workspaces WHERE id = ? AND deleted_at = ? AND purge_started_at IS NOT NULL",
  )
    .bind(policy.workspace_id, policy.workspace_deleted_at)
    .run();
  deleted += result.meta.changes ?? 0;
  return deleted;
}
