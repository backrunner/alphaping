export interface RetentionPolicyRow {
  workspace_id: string;
  workspace_pk: number;
  raw_days: number;
  rollup_5m_days: number;
  rollup_1h_days: number;
  event_days: number;
}

interface ResourceRow {
  telemetry_pk: number;
}

export type RetentionKind =
  | "machine_raw"
  | "machine_5m"
  | "machine_1h"
  | "check_raw"
  | "check_5m"
  | "check_1h"
  | "status_5m";

export interface RetentionTarget {
  kind: RetentionKind;
  controlTable: "machines" | "check_configs" | "services";
  telemetryTable:
    | "telemetry_blocks_5m"
    | "machine_rollups_5m"
    | "machine_rollups_1h"
    | "check_result_blocks_5m"
    | "check_rollups_5m"
    | "check_rollups_1h"
    | "status_buckets";
  resourceColumn: "machine_pk" | "check_pk" | "resource_pk";
  timeColumn: "block_start" | "bucket_start";
  retentionDays: keyof Pick<RetentionPolicyRow, "raw_days" | "rollup_5m_days" | "rollup_1h_days">;
  resourceType?: number;
  bucketSeconds?: number;
}

export const DAY_MS = 86_400_000;
export const RESOURCE_BATCH = 40;
export const ROW_BATCH = 200;
export const MACHINE_RAW_TARGET: RetentionTarget = {
  kind: "machine_raw",
  controlTable: "machines",
  telemetryTable: "telemetry_blocks_5m",
  resourceColumn: "machine_pk",
  timeColumn: "block_start",
  retentionDays: "raw_days",
};

const TARGETS: readonly RetentionTarget[] = [
  MACHINE_RAW_TARGET,
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
  {
    kind: "status_5m",
    controlTable: "services",
    telemetryTable: "status_buckets",
    resourceColumn: "resource_pk",
    timeColumn: "bucket_start",
    retentionDays: "rollup_5m_days",
    resourceType: 2,
    bucketSeconds: 300,
  },
];

function targetPredicates(target: RetentionTarget): {
  outer: string;
  inner: string;
  outerBindings: number[];
  innerBindings: number[];
} {
  const clauses: string[] = [];
  const bindings: number[] = [];
  if (target.resourceType !== undefined) {
    clauses.push("resource_type = ?");
    bindings.push(target.resourceType);
  }
  if (target.bucketSeconds !== undefined) {
    clauses.push("bucket_seconds = ?");
    bindings.push(target.bucketSeconds);
  }
  const predicate = clauses.length === 0 ? "" : `${clauses.join(" AND ")} AND `;
  return {
    outer: predicate,
    inner: predicate,
    outerBindings: bindings,
    innerBindings: bindings,
  };
}

async function deleteResourceRows(
  db: D1Database,
  target: RetentionTarget,
  resourcePk: number,
  cutoff: number,
  rowBatch: number,
): Promise<number> {
  const predicates = targetPredicates(target);
  const result = await db
    .prepare(
      `DELETE FROM ${target.telemetryTable}
       WHERE ${predicates.outer}(${target.resourceColumn}, ${target.timeColumn}) IN (
         SELECT ${target.resourceColumn}, ${target.timeColumn} FROM ${target.telemetryTable}
         WHERE ${target.resourceColumn} = ? AND ${predicates.inner}${target.timeColumn} < ?
         ORDER BY ${target.timeColumn} LIMIT ?
       )`,
    )
    .bind(...predicates.outerBindings, resourcePk, ...predicates.innerBindings, cutoff, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}

export async function cleanTelemetryTarget(
  env: Env,
  policy: RetentionPolicyRow,
  target: RetentionTarget,
  now: number,
  resourceBatch = RESOURCE_BATCH,
  rowBatch = ROW_BATCH,
): Promise<number> {
  const cursor = await env.TELEMETRY_DB.prepare(
    `SELECT resource_pk, time_cursor FROM retention_cursors
     WHERE workspace_pk = ? AND table_kind = ?`,
  )
    .bind(policy.workspace_pk, target.kind)
    .first<{ resource_pk: number; time_cursor: number }>();
  const previousResourceCursor = cursor?.resource_pk ?? 0;
  const cutoff = now - policy[target.retentionDays] * DAY_MS;
  const resources = await env.CONTROL_DB.prepare(
    `SELECT r.telemetry_pk FROM ${target.controlTable} r
     JOIN workspaces w ON w.id = r.workspace_id
     WHERE w.telemetry_pk = ? AND r.telemetry_pk > ?
     ORDER BY r.telemetry_pk LIMIT ?`,
  )
    .bind(policy.workspace_pk, previousResourceCursor, resourceBatch)
    .all<ResourceRow>();

  let deleted = 0;
  let nextResourceCursor = previousResourceCursor;
  let completedCutoff = cursor?.time_cursor ?? 0;
  let targetBatchFilled = false;
  for (const resource of resources.results) {
    const changes = await deleteResourceRows(
      env.TELEMETRY_DB,
      target,
      resource.telemetry_pk,
      cutoff,
      rowBatch,
    );
    deleted += changes;
    if (changes >= rowBatch) {
      targetBatchFilled = true;
      break;
    }
    nextResourceCursor = resource.telemetry_pk;
    completedCutoff = cutoff;
  }
  if (!targetBatchFilled && resources.results.length < resourceBatch) {
    nextResourceCursor = 0;
    completedCutoff = cutoff;
  }

  await env.TELEMETRY_DB.prepare(
    `INSERT INTO retention_cursors
       (workspace_pk, table_kind, resource_pk, time_cursor, lease_until, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(workspace_pk, table_kind) DO UPDATE SET
       resource_pk = excluded.resource_pk,
       time_cursor = excluded.time_cursor,
       updated_at = excluded.updated_at`,
  )
    .bind(policy.workspace_pk, target.kind, nextResourceCursor, completedCutoff, now)
    .run();
  return deleted;
}

export async function cleanTelemetryHistory(
  env: Env,
  policy: RetentionPolicyRow,
  now: number,
): Promise<number> {
  let deleted = 0;
  for (const target of TARGETS) {
    deleted += await cleanTelemetryTarget(env, policy, target, now);
  }
  return deleted;
}

export async function cleanStateEvents(
  db: D1Database,
  policy: RetentionPolicyRow,
  previousTimeCursor: number,
  now: number,
  rowBatch = ROW_BATCH,
): Promise<{ deleted: number; timeCursor: number }> {
  const cutoff = now - policy.event_days * DAY_MS;
  const result = await db
    .prepare(
      `DELETE FROM state_events WHERE (resource_type, resource_pk, occurred_at, event_id) IN (
         SELECT resource_type, resource_pk, occurred_at, event_id FROM state_events
         WHERE workspace_pk = ? AND occurred_at < ? ORDER BY occurred_at LIMIT ?
       )`,
    )
    .bind(policy.workspace_pk, cutoff, rowBatch)
    .run();
  const deleted = result.meta.changes ?? 0;
  return {
    deleted,
    timeCursor: deleted < rowBatch ? cutoff : previousTimeCursor,
  };
}
