interface RetentionPolicyRow {
  workspace_pk: number;
  raw_days: number;
  rollup_5m_days: number;
  rollup_1h_days: number;
  event_days: number;
}

interface ResourceRow {
  telemetry_pk: number;
}

type RetentionKind =
  | "machine_raw"
  | "machine_5m"
  | "machine_1h"
  | "check_raw"
  | "check_5m"
  | "check_1h";

interface RetentionTarget {
  kind: RetentionKind;
  controlTable: "machines" | "check_configs";
  telemetryTable:
    | "telemetry_blocks_5m"
    | "machine_rollups_5m"
    | "machine_rollups_1h"
    | "check_result_blocks_5m"
    | "check_rollups_5m"
    | "check_rollups_1h";
  resourceColumn: "machine_pk" | "check_pk";
  timeColumn: "block_start" | "bucket_start";
  retentionDays: keyof Pick<RetentionPolicyRow, "raw_days" | "rollup_5m_days" | "rollup_1h_days">;
}

const RESOURCE_BATCH = 40;
const ROW_BATCH = 200;
const DAY_MS = 86_400_000;
const TARGETS: readonly RetentionTarget[] = [
  {
    kind: "machine_raw",
    controlTable: "machines",
    telemetryTable: "telemetry_blocks_5m",
    resourceColumn: "machine_pk",
    timeColumn: "block_start",
    retentionDays: "raw_days",
  },
  {
    kind: "machine_5m",
    controlTable: "machines",
    telemetryTable: "machine_rollups_5m",
    resourceColumn: "machine_pk",
    timeColumn: "bucket_start",
    retentionDays: "rollup_5m_days",
  },
  {
    kind: "machine_1h",
    controlTable: "machines",
    telemetryTable: "machine_rollups_1h",
    resourceColumn: "machine_pk",
    timeColumn: "bucket_start",
    retentionDays: "rollup_1h_days",
  },
  {
    kind: "check_raw",
    controlTable: "check_configs",
    telemetryTable: "check_result_blocks_5m",
    resourceColumn: "check_pk",
    timeColumn: "block_start",
    retentionDays: "raw_days",
  },
  {
    kind: "check_5m",
    controlTable: "check_configs",
    telemetryTable: "check_rollups_5m",
    resourceColumn: "check_pk",
    timeColumn: "bucket_start",
    retentionDays: "rollup_5m_days",
  },
  {
    kind: "check_1h",
    controlTable: "check_configs",
    telemetryTable: "check_rollups_1h",
    resourceColumn: "check_pk",
    timeColumn: "bucket_start",
    retentionDays: "rollup_1h_days",
  },
];

async function deleteResourceRows(
  db: D1Database,
  table: string,
  resourceColumn: string,
  timeColumn: string,
  resourcePk: number,
  cutoff: number,
): Promise<number> {
  const statement = db
    .prepare(
      `DELETE FROM ${table}
       WHERE (${resourceColumn}, ${timeColumn}) IN (
         SELECT ${resourceColumn}, ${timeColumn} FROM ${table}
         WHERE ${resourceColumn} = ? AND ${timeColumn} < ?
         ORDER BY ${timeColumn} LIMIT ?
       )`,
    )
    .bind(resourcePk, cutoff, ROW_BATCH);
  const result = await statement.run();
  return result.meta.changes ?? 0;
}

async function cleanTarget(
  env: Env,
  policy: RetentionPolicyRow,
  target: RetentionTarget,
  now: number,
): Promise<number> {
  const cursor = await env.TELEMETRY_DB.prepare(
    `SELECT resource_pk FROM retention_cursors WHERE workspace_pk = ? AND table_kind = ?`,
  )
    .bind(policy.workspace_pk, target.kind)
    .first<{ resource_pk: number }>();
  const resourceCursor = cursor?.resource_pk ?? 0;
  const resources = await env.CONTROL_DB.prepare(
    `SELECT r.telemetry_pk FROM ${target.controlTable} r
     JOIN workspaces w ON w.id = r.workspace_id
     WHERE w.telemetry_pk = ? AND r.telemetry_pk > ?
     ORDER BY r.telemetry_pk LIMIT ?`,
  )
    .bind(policy.workspace_pk, resourceCursor, RESOURCE_BATCH)
    .all<ResourceRow>();

  let deleted = 0;
  for (const resource of resources.results) {
    deleted += await deleteResourceRows(
      env.TELEMETRY_DB,
      target.telemetryTable,
      target.resourceColumn,
      target.timeColumn,
      resource.telemetry_pk,
      now - policy[target.retentionDays] * DAY_MS,
    );
  }
  const lastResource = resources.results.at(-1)?.telemetry_pk ?? 0;
  const nextCursor = resources.results.length === RESOURCE_BATCH ? lastResource : 0;
  await env.TELEMETRY_DB.prepare(
    `INSERT INTO retention_cursors
       (workspace_pk, table_kind, resource_pk, time_cursor, lease_until, updated_at)
     VALUES (?, ?, ?, 0, 0, ?)
     ON CONFLICT(workspace_pk, table_kind) DO UPDATE SET
       resource_pk = excluded.resource_pk,
       lease_until = 0,
       updated_at = excluded.updated_at`,
  )
    .bind(policy.workspace_pk, target.kind, nextCursor, now)
    .run();
  return deleted;
}

async function cleanWorkspace(env: Env, policy: RetentionPolicyRow, now: number): Promise<number> {
  let deleted = 0;
  for (const target of TARGETS) {
    deleted += await cleanTarget(env, policy, target, now);
  }
  const events = await env.TELEMETRY_DB.prepare(
    `DELETE FROM state_events WHERE (resource_type, resource_pk, occurred_at, event_id) IN (
       SELECT resource_type, resource_pk, occurred_at, event_id FROM state_events
       WHERE workspace_pk = ? AND occurred_at < ? ORDER BY occurred_at LIMIT ?
     )`,
  )
    .bind(policy.workspace_pk, now - policy.event_days * DAY_MS, ROW_BATCH)
    .run();
  return deleted + (events.meta.changes ?? 0);
}

async function runRetention(env: Env, now: number): Promise<void> {
  const runId = crypto.randomUUID();
  await env.TELEMETRY_DB.prepare(
    "INSERT INTO retention_runs (run_id, started_at, deleted_rows) VALUES (?, ?, 0)",
  )
    .bind(runId, now)
    .run();
  try {
    const policies = await env.CONTROL_DB.prepare(
      `SELECT w.telemetry_pk AS workspace_pk, p.raw_days, p.rollup_5m_days,
              p.rollup_1h_days, p.event_days
       FROM retention_policies p JOIN workspaces w ON w.id = p.workspace_id
       WHERE w.deleted_at IS NULL LIMIT 100`,
    ).all<RetentionPolicyRow>();
    let deleted = 0;
    for (const policy of policies.results) {
      deleted += await cleanWorkspace(env, policy, now);
    }
    await env.TELEMETRY_DB.prepare(
      "UPDATE retention_runs SET completed_at = ?, deleted_rows = ? WHERE run_id = ?",
    )
      .bind(Date.now(), deleted, runId)
      .run();
  } catch (error) {
    await env.TELEMETRY_DB.prepare(
      "UPDATE retention_runs SET completed_at = ?, error_code = ? WHERE run_id = ?",
    )
      .bind(Date.now(), "retention_failed", runId)
      .run();
    throw error;
  }
}

export default {
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(runRetention(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
