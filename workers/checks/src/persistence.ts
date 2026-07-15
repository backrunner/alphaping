import { floorToFiveMinuteBlock, reportSlot } from "@alphaping/contracts";
import { prepareCheckBlockWrite } from "@alphaping/db";

import type { CheckConfigRow, ExecutedCheck } from "./types.js";

interface CheckRollup {
  totalCount: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  latencyTotalMs: number;
  latencyCount: number;
  latencyMaxMs: number | null;
}

interface StoredCheckRollup {
  total_count: number;
  healthy_count: number;
  degraded_count: number;
  down_count: number;
  latency_avg_ms: number | null;
  latency_max_ms: number | null;
}

type BlockResultRow = Record<`result_${0 | 1 | 2 | 3}`, ArrayBuffer | null>;

function uuidBytes(id: string): ArrayBuffer {
  return new TextEncoder().encode(id).buffer;
}

function emptyRollup(): CheckRollup {
  return {
    totalCount: 0,
    healthyCount: 0,
    degradedCount: 0,
    downCount: 0,
    latencyTotalMs: 0,
    latencyCount: 0,
    latencyMaxMs: null,
  };
}

function addResult(rollup: CheckRollup, result: ExecutedCheck): void {
  rollup.totalCount += 1;
  if (result.state === "healthy") rollup.healthyCount += 1;
  if (result.state === "degraded") rollup.degradedCount += 1;
  if (result.state === "down") rollup.downCount += 1;
  if (result.latencyMs !== null) {
    rollup.latencyTotalMs += result.latencyMs;
    rollup.latencyCount += 1;
    rollup.latencyMaxMs = Math.max(rollup.latencyMaxMs ?? 0, result.latencyMs);
  }
}

function addStoredRollup(rollup: CheckRollup, stored: StoredCheckRollup): void {
  rollup.totalCount += stored.total_count;
  rollup.healthyCount += stored.healthy_count;
  rollup.degradedCount += stored.degraded_count;
  rollup.downCount += stored.down_count;
  if (stored.latency_avg_ms !== null) {
    rollup.latencyTotalMs += stored.latency_avg_ms * stored.total_count;
    rollup.latencyCount += stored.total_count;
  }
  if (stored.latency_max_ms !== null) {
    rollup.latencyMaxMs = Math.max(rollup.latencyMaxMs ?? 0, stored.latency_max_ms);
  }
}

function parseStoredResult(payload: ArrayBuffer | null): ExecutedCheck | null {
  if (payload === null) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const data = parsed as Readonly<Record<string, unknown>>;
    if (data.state !== "healthy" && data.state !== "degraded" && data.state !== "down") {
      return null;
    }
    return {
      state: data.state,
      latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
      failureCode: typeof data.failureCode === "string" ? data.failureCode : null,
    };
  } catch {
    return null;
  }
}

function prepareRollupStatement(
  db: D1Database,
  table: "check_rollups_5m" | "check_rollups_1h",
  config: CheckConfigRow,
  bucketStart: number,
  rollup: CheckRollup,
): D1PreparedStatement {
  const latencyAverage =
    rollup.latencyCount === 0 ? null : Math.round(rollup.latencyTotalMs / rollup.latencyCount);
  return db
    .prepare(
      `INSERT INTO ${table}
        (check_pk, workspace_pk, bucket_start, total_count, healthy_count,
         degraded_count, down_count, latency_avg_ms, latency_max_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(check_pk, bucket_start) DO UPDATE SET
         total_count = excluded.total_count,
         healthy_count = excluded.healthy_count,
         degraded_count = excluded.degraded_count,
         down_count = excluded.down_count,
         latency_avg_ms = excluded.latency_avg_ms,
         latency_max_ms = excluded.latency_max_ms`,
    )
    .bind(
      config.telemetry_pk,
      config.workspace_telemetry_pk,
      bucketStart,
      rollup.totalCount,
      rollup.healthyCount,
      rollup.degradedCount,
      rollup.downCount,
      latencyAverage,
      rollup.latencyMaxMs,
    );
}

async function prepareClosedRollups(
  db: D1Database,
  config: CheckConfigRow,
  nominalMinute: number,
  current: ExecutedCheck,
): Promise<readonly D1PreparedStatement[]> {
  if (reportSlot(nominalMinute) !== 4) return [];
  const fiveMinuteBucket = floorToFiveMinuteBlock(nominalMinute);
  const block = await db
    .prepare(
      `SELECT result_0, result_1, result_2, result_3
       FROM check_result_blocks_5m WHERE check_pk = ? AND block_start = ?`,
    )
    .bind(config.telemetry_pk, fiveMinuteBucket)
    .first<BlockResultRow>();
  const fiveMinute = emptyRollup();
  if (block) {
    for (const payload of [block.result_0, block.result_1, block.result_2, block.result_3]) {
      const stored = parseStoredResult(payload);
      if (stored) addResult(fiveMinute, stored);
    }
  }
  addResult(fiveMinute, current);
  const statements: D1PreparedStatement[] = [
    prepareRollupStatement(db, "check_rollups_5m", config, fiveMinuteBucket, fiveMinute),
  ];

  const minuteInHour = Math.floor((nominalMinute % 3_600_000) / 60_000);
  if (minuteInHour !== 59) return statements;
  const hourStart = Math.floor(nominalMinute / 3_600_000) * 3_600_000;
  const previous = await db
    .prepare(
      `SELECT total_count, healthy_count, degraded_count, down_count,
              latency_avg_ms, latency_max_ms
       FROM check_rollups_5m
       WHERE check_pk = ? AND bucket_start >= ? AND bucket_start < ?
       ORDER BY bucket_start`,
    )
    .bind(config.telemetry_pk, hourStart, fiveMinuteBucket)
    .all<StoredCheckRollup>();
  const hourly = emptyRollup();
  for (const stored of previous.results) addStoredRollup(hourly, stored);
  addStoredRollup(hourly, {
    total_count: fiveMinute.totalCount,
    healthy_count: fiveMinute.healthyCount,
    degraded_count: fiveMinute.degradedCount,
    down_count: fiveMinute.downCount,
    latency_avg_ms:
      fiveMinute.latencyCount === 0
        ? null
        : Math.round(fiveMinute.latencyTotalMs / fiveMinute.latencyCount),
    latency_max_ms: fiveMinute.latencyMaxMs,
  });
  statements.push(prepareRollupStatement(db, "check_rollups_1h", config, hourStart, hourly));
  return statements;
}

export async function persistCheckResult(
  db: D1Database,
  config: CheckConfigRow,
  nominalMinute: number,
  observedAt: number,
  result: ExecutedCheck,
): Promise<void> {
  const resultId = crypto.randomUUID();
  const payload = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      id: resultId,
      observedAt,
      state: result.state,
      latencyMs: result.latencyMs,
      failureCode: result.failureCode,
    }),
  );
  const payloadHash = await crypto.subtle.digest("SHA-256", payload);
  const block = prepareCheckBlockWrite({
    checkPk: config.telemetry_pk,
    workspacePk: config.workspace_telemetry_pk,
    nominalMinute,
    resultId: uuidBytes(resultId),
    payloadHash,
    payload: payload.buffer,
    schemaVersion: 1,
  });
  const latest = db
    .prepare(
      `INSERT INTO check_latest
        (check_pk, workspace_pk, observed_at, state, latency_ms, failure_code, result_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(check_pk) DO UPDATE SET
        workspace_pk = excluded.workspace_pk,
        observed_at = excluded.observed_at,
        state = excluded.state,
        latency_ms = excluded.latency_ms,
        failure_code = excluded.failure_code,
        result_id = excluded.result_id
       WHERE excluded.observed_at >= check_latest.observed_at`,
    )
    .bind(
      config.telemetry_pk,
      config.workspace_telemetry_pk,
      observedAt,
      result.state,
      result.latencyMs,
      result.failureCode,
      uuidBytes(resultId),
    );
  const closedRollups = await prepareClosedRollups(db, config, nominalMinute, result);
  await db.batch([db.prepare(block.query).bind(...block.values), latest, ...closedRollups]);
}
