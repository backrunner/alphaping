const ID_BATCH = 50;

export interface TelemetryPurgeResult {
  complete: boolean;
  deleted: number;
}

interface TimedTarget {
  table: string;
  resourceColumn: "machine_pk" | "check_pk";
  timeColumn: "block_start" | "bucket_start";
}

const MACHINE_TARGETS: readonly TimedTarget[] = [
  { table: "telemetry_blocks_5m", resourceColumn: "machine_pk", timeColumn: "block_start" },
  { table: "machine_rollups_5m", resourceColumn: "machine_pk", timeColumn: "bucket_start" },
  { table: "machine_rollups_1h", resourceColumn: "machine_pk", timeColumn: "bucket_start" },
];

const CHECK_TARGETS: readonly TimedTarget[] = [
  { table: "check_result_blocks_5m", resourceColumn: "check_pk", timeColumn: "block_start" },
  { table: "check_rollups_5m", resourceColumn: "check_pk", timeColumn: "bucket_start" },
  { table: "check_rollups_1h", resourceColumn: "check_pk", timeColumn: "bucket_start" },
];

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

async function deleteTimedResourceRows(
  db: D1Database,
  target: TimedTarget,
  resourcePk: number,
  rowBatch: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM ${target.table}
       WHERE (${target.resourceColumn}, ${target.timeColumn}) IN (
         SELECT ${target.resourceColumn}, ${target.timeColumn} FROM ${target.table}
         WHERE ${target.resourceColumn} = ? ORDER BY ${target.timeColumn} LIMIT ?
       )`,
    )
    .bind(resourcePk, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}

async function deleteResourceEvents(
  db: D1Database,
  resourceType: 1 | 2,
  resourcePk: number,
  rowBatch: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM state_events
       WHERE (resource_type, resource_pk, occurred_at, event_id) IN (
         SELECT resource_type, resource_pk, occurred_at, event_id FROM state_events
         WHERE resource_type = ? AND resource_pk = ?
         ORDER BY occurred_at, event_id LIMIT ?
       )`,
    )
    .bind(resourceType, resourcePk, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}

async function deleteStatusBuckets(
  db: D1Database,
  resourceType: 1 | 2,
  resourcePk: number,
  rowBatch: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM status_buckets
       WHERE (resource_type, resource_pk, bucket_seconds, bucket_start) IN (
         SELECT resource_type, resource_pk, bucket_seconds, bucket_start FROM status_buckets
         WHERE resource_type = ? AND resource_pk = ?
         ORDER BY bucket_seconds, bucket_start LIMIT ?
       )`,
    )
    .bind(resourceType, resourcePk, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}

async function deleteAgentReplayRows(
  db: D1Database,
  agentIds: readonly string[],
  rowBatch: number,
): Promise<number> {
  let deleted = 0;
  for (let offset = 0; offset < agentIds.length; offset += ID_BATCH) {
    const ids = agentIds.slice(offset, offset + ID_BATCH);
    const result = await db
      .prepare(
        `DELETE FROM agent_replay_state WHERE (agent_id, key_epoch) IN (
           SELECT agent_id, key_epoch FROM agent_replay_state
           WHERE agent_id IN (${placeholders(ids.length)})
           ORDER BY agent_id, key_epoch LIMIT ?
         )`,
      )
      .bind(...ids, rowBatch)
      .run();
    deleted += result.meta.changes ?? 0;
  }
  return deleted;
}

async function machineTelemetryRemains(
  db: D1Database,
  machinePk: number,
  agentIds: readonly string[],
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT CASE WHEN
         EXISTS(SELECT 1 FROM telemetry_blocks_5m WHERE machine_pk = ?) OR
         EXISTS(SELECT 1 FROM machine_rollups_5m WHERE machine_pk = ?) OR
         EXISTS(SELECT 1 FROM machine_rollups_1h WHERE machine_pk = ?) OR
         EXISTS(SELECT 1 FROM machine_latest WHERE machine_pk = ?) OR
         EXISTS(SELECT 1 FROM state_events WHERE resource_type = 1 AND resource_pk = ?) OR
         EXISTS(SELECT 1 FROM status_buckets WHERE resource_type = 1 AND resource_pk = ?)
       THEN 1 ELSE 0 END AS present`,
    )
    .bind(machinePk, machinePk, machinePk, machinePk, machinePk, machinePk)
    .first<{ present: number }>();
  if (row?.present === 1) return true;
  for (let offset = 0; offset < agentIds.length; offset += ID_BATCH) {
    const ids = agentIds.slice(offset, offset + ID_BATCH);
    const replay = await db
      .prepare(
        `SELECT 1 AS present FROM agent_replay_state
         WHERE agent_id IN (${placeholders(ids.length)}) LIMIT 1`,
      )
      .bind(...ids)
      .first<{ present: number }>();
    if (replay) return true;
  }
  return false;
}

export async function purgeMachineTelemetry(
  db: D1Database,
  machinePk: number,
  agentIds: readonly string[],
  rowBatch: number,
): Promise<TelemetryPurgeResult> {
  let deleted = 0;
  for (const target of MACHINE_TARGETS) {
    deleted += await deleteTimedResourceRows(db, target, machinePk, rowBatch);
  }
  deleted += await deleteResourceEvents(db, 1, machinePk, rowBatch);
  deleted += await deleteStatusBuckets(db, 1, machinePk, rowBatch);
  const latest = await db
    .prepare("DELETE FROM machine_latest WHERE machine_pk = ?")
    .bind(machinePk)
    .run();
  deleted += latest.meta.changes ?? 0;
  deleted += await deleteAgentReplayRows(db, agentIds, rowBatch);
  return {
    complete: !(await machineTelemetryRemains(db, machinePk, agentIds)),
    deleted,
  };
}

async function deleteCheckRows(
  db: D1Database,
  target: TimedTarget,
  checkPks: readonly number[],
  rowBatch: number,
): Promise<number> {
  let deleted = 0;
  for (let offset = 0; offset < checkPks.length; offset += ID_BATCH) {
    const ids = checkPks.slice(offset, offset + ID_BATCH);
    const result = await db
      .prepare(
        `DELETE FROM ${target.table}
         WHERE (${target.resourceColumn}, ${target.timeColumn}) IN (
           SELECT ${target.resourceColumn}, ${target.timeColumn} FROM ${target.table}
           WHERE ${target.resourceColumn} IN (${placeholders(ids.length)})
           ORDER BY ${target.resourceColumn}, ${target.timeColumn} LIMIT ?
         )`,
      )
      .bind(...ids, rowBatch)
      .run();
    deleted += result.meta.changes ?? 0;
  }
  return deleted;
}

async function checkTelemetryRemains(
  db: D1Database,
  checkPks: readonly number[],
): Promise<boolean> {
  for (let offset = 0; offset < checkPks.length; offset += ID_BATCH) {
    const ids = checkPks.slice(offset, offset + ID_BATCH);
    for (const target of [
      ...CHECK_TARGETS,
      { table: "check_latest", resourceColumn: "check_pk" },
    ]) {
      const row = await db
        .prepare(
          `SELECT 1 AS present FROM ${target.table}
           WHERE ${target.resourceColumn} IN (${placeholders(ids.length)}) LIMIT 1`,
        )
        .bind(...ids)
        .first<{ present: number }>();
      if (row) return true;
    }
  }
  return false;
}

export async function purgeServiceTelemetry(
  db: D1Database,
  servicePk: number,
  checkPks: readonly number[],
  rowBatch: number,
): Promise<TelemetryPurgeResult> {
  let deleted = 0;
  for (const target of CHECK_TARGETS) {
    deleted += await deleteCheckRows(db, target, checkPks, rowBatch);
  }
  for (let offset = 0; offset < checkPks.length; offset += ID_BATCH) {
    const ids = checkPks.slice(offset, offset + ID_BATCH);
    const latest = await db
      .prepare(`DELETE FROM check_latest WHERE check_pk IN (${placeholders(ids.length)})`)
      .bind(...ids)
      .run();
    deleted += latest.meta.changes ?? 0;
  }
  deleted += await deleteResourceEvents(db, 2, servicePk, rowBatch);
  deleted += await deleteStatusBuckets(db, 2, servicePk, rowBatch);
  const latest = await db
    .prepare("DELETE FROM service_latest WHERE service_pk = ?")
    .bind(servicePk)
    .run();
  deleted += latest.meta.changes ?? 0;
  const serviceRowsRemain = await db
    .prepare(
      `SELECT CASE WHEN
         EXISTS(SELECT 1 FROM service_latest WHERE service_pk = ?) OR
         EXISTS(SELECT 1 FROM state_events WHERE resource_type = 2 AND resource_pk = ?) OR
         EXISTS(SELECT 1 FROM status_buckets WHERE resource_type = 2 AND resource_pk = ?)
       THEN 1 ELSE 0 END AS present`,
    )
    .bind(servicePk, servicePk, servicePk)
    .first<{ present: number }>();
  return {
    complete: serviceRowsRemain?.present !== 1 && !(await checkTelemetryRemains(db, checkPks)),
    deleted,
  };
}

export async function workspaceTelemetryIsEmpty(
  db: D1Database,
  workspacePk: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT CASE WHEN
         EXISTS(SELECT 1 FROM telemetry_blocks_5m WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM machine_rollups_5m WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM machine_rollups_1h WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM machine_latest WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM check_result_blocks_5m WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM check_rollups_5m WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM check_rollups_1h WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM check_latest WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM service_latest WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM status_buckets WHERE workspace_pk = ?) OR
         EXISTS(SELECT 1 FROM state_events WHERE workspace_pk = ?)
       THEN 1 ELSE 0 END AS present`,
    )
    .bind(...Array.from({ length: 11 }, () => workspacePk))
    .first<{ present: number }>();
  return row?.present !== 1;
}

export async function deleteWorkspaceTelemetryState(
  db: D1Database,
  workspacePk: number,
): Promise<number> {
  const results = await db.batch([
    db.prepare("DELETE FROM workspace_status_summary WHERE workspace_pk = ?").bind(workspacePk),
    db.prepare("DELETE FROM retention_cursors WHERE workspace_pk = ?").bind(workspacePk),
  ]);
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}
