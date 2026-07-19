import { d1BlobToArrayBuffer, floorToFiveMinuteBlock, reportSlot } from "@alphaping/contracts";
import { prepareCheckBlockWrite } from "@alphaping/db";

import type { CheckConfigRow, ExecutedCheck } from "./types.js";

type CheckState = ExecutedCheck["state"] | "unknown";
type ServiceState = CheckState | "maintenance";

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

interface ConfirmationState {
  state: CheckState;
  failure_code: string | null;
  failure_summary: string | null;
  consecutive_failures: number;
  consecutive_successes: number;
}

interface PreviousCheckLatest extends ConfirmationState {
  config_revision: number;
  result_id: unknown;
}

interface ConfirmedResult extends Omit<ExecutedCheck, "state"> {
  state: CheckState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

interface ClosedRollups {
  statements: readonly D1PreparedStatement[];
  fiveMinute: CheckRollup | null;
}

type BlockResultRow = Record<`result_${0 | 1 | 2 | 3}`, unknown>;

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

function parseStoredResult(payload: unknown): ExecutedCheck | null {
  if (payload === null || payload === undefined) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(d1BlobToArrayBuffer(payload))) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const data = parsed as Readonly<Record<string, unknown>>;
    if (data.state !== "healthy" && data.state !== "degraded" && data.state !== "down") {
      return null;
    }
    return {
      state: data.state,
      latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
      failureCode: typeof data.failureCode === "string" ? data.failureCode : null,
      failureSummary: typeof data.failureSummary === "string" ? data.failureSummary : null,
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
         latency_max_ms = excluded.latency_max_ms
       WHERE ${table}.workspace_pk = excluded.workspace_pk`,
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
): Promise<ClosedRollups> {
  if (reportSlot(nominalMinute) !== 4) return { statements: [], fiveMinute: null };
  const fiveMinuteBucket = floorToFiveMinuteBlock(nominalMinute);
  const block = await db
    .prepare(
      `SELECT result_0, result_1, result_2, result_3
       FROM check_result_blocks_5m
       WHERE workspace_pk = ? AND check_pk = ? AND block_start = ?`,
    )
    .bind(config.workspace_telemetry_pk, config.telemetry_pk, fiveMinuteBucket)
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
  if (minuteInHour !== 59) return { statements, fiveMinute };
  const hourStart = Math.floor(nominalMinute / 3_600_000) * 3_600_000;
  const previous = await db
    .prepare(
      `SELECT total_count, healthy_count, degraded_count, down_count,
              latency_avg_ms, latency_max_ms
       FROM check_rollups_5m
       WHERE workspace_pk = ? AND check_pk = ? AND bucket_start >= ? AND bucket_start < ?
       ORDER BY bucket_start`,
    )
    .bind(config.workspace_telemetry_pk, config.telemetry_pk, hourStart, fiveMinuteBucket)
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
  return { statements, fiveMinute };
}

export function applyConfirmationWindow(
  config: CheckConfigRow,
  previous: ConfirmationState | null,
  result: ExecutedCheck,
): ConfirmedResult {
  if (result.state === "healthy") {
    const successes = (previous?.consecutive_successes ?? 0) + 1;
    const priorState = previous?.state ?? "healthy";
    const confirmed =
      previous === null || priorState === "healthy" || successes >= config.recovery_confirmations;
    return {
      state: confirmed ? "healthy" : priorState === "unknown" ? "unknown" : priorState,
      latencyMs: result.latencyMs,
      failureCode: confirmed ? null : (previous?.failure_code ?? "recovery_pending"),
      failureSummary: confirmed ? null : (previous?.failure_summary ?? "recovery_pending"),
      consecutiveFailures: 0,
      consecutiveSuccesses: successes,
    };
  }

  const failures = (previous?.consecutive_failures ?? 0) + 1;
  const priorState = previous?.state ?? "unknown";
  const alreadyFailed = priorState === "down" || priorState === "degraded";
  const confirmed = alreadyFailed || failures >= config.failure_confirmations;
  const state =
    priorState === "down" && result.state === "degraded"
      ? "down"
      : confirmed
        ? result.state
        : priorState;
  return {
    state,
    latencyMs: result.latencyMs,
    failureCode: confirmed ? result.failureCode : "failure_pending",
    failureSummary: confirmed
      ? result.failureSummary
      : (result.failureSummary ?? result.failureCode),
    consecutiveFailures: failures,
    consecutiveSuccesses: 0,
  };
}

export function serviceState(
  checks: readonly { state: CheckState; critical: number }[],
  maintenanceUntil: number | null,
  now: number,
): ServiceState {
  if (maintenanceUntil !== null && maintenanceUntil > now) return "maintenance";
  if (checks.some((check) => check.critical === 1 && check.state === "down")) return "down";
  if (checks.some((check) => check.state === "down" || check.state === "degraded")) {
    return "degraded";
  }
  if (checks.some((check) => check.state === "healthy")) return "healthy";
  return "unknown";
}

function serviceReason(state: ServiceState): string {
  return state === "maintenance" ? "maintenance_window" : `check_${state}`;
}

const SERVICE_STATE_CTE = `WITH service_aggregate(rank) AS (
  SELECT COALESCE(MAX(CASE
    WHEN critical = 1 AND state = 'down' THEN 3
    WHEN state IN ('down', 'degraded') THEN 2
    WHEN state = 'healthy' THEN 1
    ELSE 0 END), 0)
  FROM check_latest WHERE workspace_pk = ? AND service_pk = ?
), next_service(state) AS (
  SELECT CASE
    WHEN ? > ? THEN 'maintenance'
    WHEN service_aggregate.rank = 3 THEN 'down'
    WHEN service_aggregate.rank = 2 THEN 'degraded'
    WHEN service_aggregate.rank = 1 THEN 'healthy'
    ELSE 'unknown'
  END FROM service_aggregate
)`;

function serviceReasonSql(state: string): string {
  return `CASE ${state}
    WHEN 'maintenance' THEN 'maintenance_window'
    WHEN 'down' THEN 'check_down'
    WHEN 'degraded' THEN 'check_degraded'
    WHEN 'healthy' THEN 'check_healthy'
    ELSE 'check_unknown' END`;
}

function prepareServiceStateStatements(
  db: D1Database,
  config: CheckConfigRow,
  observedAt: number,
  resultId: ArrayBuffer,
): readonly D1PreparedStatement[] {
  const inputBindings = [
    config.workspace_telemetry_pk,
    config.service_telemetry_pk,
    config.service_maintenance_until,
    observedAt,
  ];
  const currentResult = `SELECT 1 FROM check_latest
                         WHERE workspace_pk = ? AND check_pk = ?
                           AND config_revision = ? AND result_id = ?`;
  return [
    db
      .prepare(
        `${SERVICE_STATE_CTE}
         INSERT OR IGNORE INTO state_events
          (workspace_pk, resource_type, resource_pk, occurred_at, event_id,
           previous_state, current_state, reason_code)
         SELECT ?, 2, ?, ?, ?, COALESCE(previous.state, 'unknown'), next_service.state,
                ${serviceReasonSql("next_service.state")}
         FROM next_service
         LEFT JOIN service_latest previous
           ON previous.workspace_pk = ? AND previous.service_pk = ?
         WHERE EXISTS (${currentResult})
           AND NOT EXISTS (
             SELECT 1 FROM service_latest existing
             WHERE existing.service_pk = ? AND existing.workspace_pk != ?
           )
           AND COALESCE(previous.state, 'unknown') != next_service.state`,
      )
      .bind(
        ...inputBindings,
        config.workspace_telemetry_pk,
        config.service_telemetry_pk,
        observedAt,
        resultId,
        config.workspace_telemetry_pk,
        config.service_telemetry_pk,
        config.workspace_telemetry_pk,
        config.telemetry_pk,
        config.config_revision,
        resultId,
        config.service_telemetry_pk,
        config.workspace_telemetry_pk,
      ),
    db
      .prepare(
        `INSERT INTO service_latest
          (service_pk, workspace_pk, state, status_since, reason_code,
           last_transition_at, updated_at)
         SELECT ?, ?, event.current_state, ?, event.reason_code, ?, ?
         FROM state_events event
         WHERE event.workspace_pk = ? AND event.resource_type = 2 AND event.resource_pk = ?
           AND event.occurred_at = ? AND event.event_id = ?
           AND changes() = 1
         ON CONFLICT(service_pk) DO UPDATE SET
           workspace_pk = excluded.workspace_pk,
           state = excluded.state,
           status_since = excluded.status_since,
           reason_code = excluded.reason_code,
           last_transition_at = excluded.last_transition_at,
           updated_at = excluded.updated_at
         WHERE service_latest.workspace_pk = excluded.workspace_pk`,
      )
      .bind(
        config.service_telemetry_pk,
        config.workspace_telemetry_pk,
        observedAt,
        observedAt,
        observedAt,
        config.workspace_telemetry_pk,
        config.service_telemetry_pk,
        observedAt,
        resultId,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO service_latest
          (service_pk, workspace_pk, state, status_since, reason_code,
           last_transition_at, updated_at)
         SELECT ?, ?, 'unknown', ?, 'check_unknown', ?, ?
         WHERE EXISTS (${currentResult})
           AND NOT EXISTS (
             SELECT 1 FROM state_events event
             WHERE event.workspace_pk = ? AND event.resource_type = 2 AND event.resource_pk = ?
               AND event.occurred_at = ? AND event.event_id = ?
           )`,
      )
      .bind(
        config.service_telemetry_pk,
        config.workspace_telemetry_pk,
        observedAt,
        observedAt,
        observedAt,
        config.workspace_telemetry_pk,
        config.telemetry_pk,
        config.config_revision,
        resultId,
        config.workspace_telemetry_pk,
        config.service_telemetry_pk,
        observedAt,
        resultId,
      ),
  ];
}

function prepareStatusBucket(
  db: D1Database,
  config: CheckConfigRow,
  nominalMinute: number,
  rollup: CheckRollup,
): D1PreparedStatement {
  const state: ServiceState =
    config.service_maintenance_until !== null && config.service_maintenance_until > nominalMinute
      ? "maintenance"
      : rollup.downCount > 0
        ? config.critical === 1
          ? "down"
          : "degraded"
        : rollup.degradedCount > 0
          ? "degraded"
          : rollup.healthyCount > 0
            ? "healthy"
            : "unknown";
  const availability =
    rollup.totalCount === 0 ? 0 : Math.round((rollup.healthyCount / rollup.totalCount) * 1_000);
  const latencyAverage =
    rollup.latencyCount === 0 ? null : Math.round(rollup.latencyTotalMs / rollup.latencyCount);
  const bucketStart = floorToFiveMinuteBlock(nominalMinute);
  return db
    .prepare(
      `INSERT INTO status_buckets
        (resource_type, resource_pk, workspace_pk, bucket_start, bucket_seconds,
         state, availability_permille, latency_avg_ms, latency_max_ms, summary_code)
       VALUES (2, ?, ?, ?, 300, ?, ?, ?, ?, ?)
       ON CONFLICT(resource_type, resource_pk, bucket_seconds, bucket_start) DO UPDATE SET
         state = CASE
           WHEN status_buckets.state = 'maintenance' OR excluded.state = 'maintenance' THEN 'maintenance'
           WHEN status_buckets.state = 'down' OR excluded.state = 'down' THEN 'down'
           WHEN status_buckets.state = 'degraded' OR excluded.state = 'degraded' THEN 'degraded'
           WHEN status_buckets.state = 'healthy' OR excluded.state = 'healthy' THEN 'healthy'
           ELSE 'unknown' END,
         availability_permille = MIN(status_buckets.availability_permille, excluded.availability_permille),
         latency_avg_ms = CASE
           WHEN status_buckets.latency_avg_ms IS NULL THEN excluded.latency_avg_ms
           WHEN excluded.latency_avg_ms IS NULL THEN status_buckets.latency_avg_ms
           ELSE MAX(status_buckets.latency_avg_ms, excluded.latency_avg_ms) END,
         latency_max_ms = CASE
           WHEN status_buckets.latency_max_ms IS NULL THEN excluded.latency_max_ms
           WHEN excluded.latency_max_ms IS NULL THEN status_buckets.latency_max_ms
           ELSE MAX(status_buckets.latency_max_ms, excluded.latency_max_ms) END,
         summary_code = CASE
           WHEN status_buckets.state = 'maintenance' OR excluded.state = 'maintenance' THEN 'maintenance_window'
           WHEN status_buckets.state = 'down' OR excluded.state = 'down' THEN 'check_down'
           WHEN status_buckets.state = 'degraded' OR excluded.state = 'degraded' THEN 'check_degraded'
           ELSE excluded.summary_code END
       WHERE status_buckets.workspace_pk = excluded.workspace_pk`,
    )
    .bind(
      config.service_telemetry_pk,
      config.workspace_telemetry_pk,
      bucketStart,
      state,
      availability,
      latencyAverage,
      rollup.latencyMaxMs,
      serviceReason(state),
    );
}

async function executionId(
  checkId: string,
  configRevision: number,
  nominalMinute: number,
): Promise<ArrayBuffer> {
  const material =
    configRevision === 1
      ? `${checkId}:${nominalMinute}`
      : `${checkId}:${configRevision}:${nominalMinute}`;
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((value, index) => value === rightBytes[index])
  );
}

export async function persistCheckResult(
  db: D1Database,
  config: CheckConfigRow,
  nominalMinute: number,
  observedAt: number,
  result: ExecutedCheck,
): Promise<void> {
  const [resultId, previousCheck] = await Promise.all([
    executionId(config.id, config.config_revision, nominalMinute),
    db
      .prepare(
        `SELECT state, failure_code, failure_summary, consecutive_failures,
              consecutive_successes, config_revision, result_id
       FROM check_latest WHERE workspace_pk = ? AND check_pk = ?`,
      )
      .bind(config.workspace_telemetry_pk, config.telemetry_pk)
      .first<PreviousCheckLatest>(),
  ]);
  if (previousCheck !== null && previousCheck.config_revision > config.config_revision) return;
  if (
    previousCheck !== null &&
    equalBytes(d1BlobToArrayBuffer(previousCheck.result_id), resultId)
  ) {
    return;
  }
  const confirmed = applyConfirmationWindow(config, previousCheck, result);
  const payload = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      id: hex(resultId),
      configRevision: config.config_revision,
      observedAt,
      state: result.state,
      latencyMs: result.latencyMs,
      failureCode: result.failureCode,
      failureSummary: result.failureSummary,
    }),
  );
  const payloadHash = await crypto.subtle.digest("SHA-256", payload);
  const block = prepareCheckBlockWrite({
    checkPk: config.telemetry_pk,
    workspacePk: config.workspace_telemetry_pk,
    nominalMinute,
    resultId,
    payloadHash,
    payload: payload.buffer,
    schemaVersion: 1,
  });
  const latest = db
    .prepare(
      `INSERT INTO check_latest
      (check_pk, workspace_pk, service_pk, observed_at, state, latency_ms, failure_code,
       failure_summary, consecutive_failures, consecutive_successes, critical,
       config_revision, result_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(check_pk) DO UPDATE SET
      workspace_pk = excluded.workspace_pk,
      service_pk = excluded.service_pk,
      observed_at = excluded.observed_at,
      state = excluded.state,
      latency_ms = excluded.latency_ms,
      failure_code = excluded.failure_code,
      failure_summary = excluded.failure_summary,
      consecutive_failures = excluded.consecutive_failures,
      consecutive_successes = excluded.consecutive_successes,
      critical = excluded.critical,
      config_revision = excluded.config_revision,
      result_id = excluded.result_id
     WHERE check_latest.workspace_pk = excluded.workspace_pk
       AND (excluded.config_revision > check_latest.config_revision
        OR (excluded.config_revision = check_latest.config_revision
            AND excluded.observed_at >= check_latest.observed_at))`,
    )
    .bind(
      config.telemetry_pk,
      config.workspace_telemetry_pk,
      config.service_telemetry_pk,
      observedAt,
      confirmed.state,
      confirmed.latencyMs,
      confirmed.failureCode,
      confirmed.failureSummary?.slice(0, 160) ?? null,
      confirmed.consecutiveFailures,
      confirmed.consecutiveSuccesses,
      config.critical,
      config.config_revision,
      resultId,
    );

  const serviceStatements = prepareServiceStateStatements(db, config, observedAt, resultId);

  const closedRollups = await prepareClosedRollups(db, config, nominalMinute, result);
  const statusStatements =
    closedRollups.fiveMinute === null
      ? []
      : [prepareStatusBucket(db, config, nominalMinute, closedRollups.fiveMinute)];
  await db.batch([
    db.prepare(block.query).bind(...block.values),
    latest,
    ...closedRollups.statements,
    ...serviceStatements,
    ...statusStatements,
  ]);
}
