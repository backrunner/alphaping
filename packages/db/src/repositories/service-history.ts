import { d1BlobToArrayBuffer } from "@alphaping/contracts";

import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  HistoryCursorError,
  type HistoryResolution,
} from "./history-cursor.js";
import type { MonitorState } from "./service-models.js";
import { loadAuthorizedServiceScope, ServiceNotFoundError } from "./services.js";

const ROLLUP_PAGE_SIZE = 744;
const RAW_BLOCK_PAGE_SIZE = 72;
const RAW_POINT_LIMIT = 4_320;
const RAW_PAYLOAD_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_CHECK_PAYLOAD_BYTES = 64 * 1024;

type ServiceHistoryResolution = Exclude<HistoryResolution, "raw">;
type CheckState = Exclude<MonitorState, "maintenance">;

interface ServiceHistoryRow {
  bucket_start: number;
  state: string | null;
  state_rank: number | null;
  availability_permille: number;
  latency_avg_ms: number | null;
  latency_max_ms: number | null;
  summary_code: string | null;
}

interface CheckRollupRow {
  bucket_start: number;
  total_count: number;
  healthy_count: number;
  degraded_count: number;
  down_count: number;
  latency_avg_ms: number | null;
  latency_max_ms: number | null;
}

interface CheckBlockRow {
  block_start: number;
  result_0: unknown;
  result_1: unknown;
  result_2: unknown;
  result_3: unknown;
  result_4: unknown;
}

export interface ServiceHistoryPoint {
  bucketStart: number;
  state: MonitorState;
  availabilityPermille: number;
  latencyAverageMs: number | null;
  latencyMaxMs: number | null;
  summaryCode: string | null;
}

export interface RawCheckHistoryPoint {
  kind: "raw";
  observedAt: number;
  state: CheckState;
  latencyMs: number | null;
  failureCode: string | null;
  failureSummary: string | null;
}

export interface CheckRollupHistoryPoint {
  kind: "rollup";
  bucketStart: number;
  totalCount: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  unknownCount: number;
  latencyAverageMs: number | null;
  latencyMaxMs: number | null;
}

export type CheckHistoryPoint = RawCheckHistoryPoint | CheckRollupHistoryPoint;

export interface ServiceHistoryPage {
  points: readonly ServiceHistoryPoint[];
  nextCursor: string | null;
}

export interface CheckHistoryPage {
  points: readonly CheckHistoryPoint[];
  nextCursor: string | null;
}

export class ServiceHistoryRangeError extends Error {}
export class ServiceHistoryDataError extends Error {}

function validState(value: unknown): value is CheckState {
  return value === "healthy" || value === "degraded" || value === "down" || value === "unknown";
}

function monitorState(value: string | null, rank: number | null): MonitorState {
  if (
    value === "healthy" ||
    value === "degraded" ||
    value === "down" ||
    value === "maintenance" ||
    value === "unknown"
  ) {
    return value;
  }
  return (
    (
      {
        4: "maintenance",
        3: "down",
        2: "degraded",
        1: "healthy",
        0: "unknown",
      } as const
    )[rank ?? 0] ?? "unknown"
  );
}

function boundedOptionalString(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maximum) throw new ServiceHistoryDataError();
  return value;
}

function optionalLatency(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0 || value > 120_000) {
    throw new ServiceHistoryDataError();
  }
  return value;
}

function rawPoint(value: unknown): RawCheckHistoryPoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServiceHistoryDataError();
  }
  const data = value as Readonly<Record<string, unknown>>;
  if (
    typeof data.observedAtMs !== "number" ||
    !Number.isSafeInteger(data.observedAtMs) ||
    data.observedAtMs <= 0 ||
    !validState(data.state)
  ) {
    throw new ServiceHistoryDataError();
  }
  return {
    kind: "raw",
    observedAt: data.observedAtMs,
    state: data.state,
    latencyMs: optionalLatency(data.latencyMs),
    failureCode: boundedOptionalString(data.failureCode, 64),
    failureSummary: boundedOptionalString(data.failureSummary, 512),
  };
}

export function decodeStoredCheckHistoryPayload(
  payload: ArrayBuffer,
): readonly RawCheckHistoryPoint[] {
  if (payload.byteLength === 0 || payload.byteLength > MAX_CHECK_PAYLOAD_BYTES) {
    throw new ServiceHistoryDataError();
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ServiceHistoryDataError();
    }
    const data = parsed as Readonly<Record<string, unknown>>;
    if (data.v === 1) {
      return [rawPoint({ ...data, observedAtMs: data.observedAt })];
    }
    if (data.v === 2 && Array.isArray(data.samples) && data.samples.length <= 12) {
      if (data.samples.length === 0) throw new ServiceHistoryDataError();
      return data.samples.map(rawPoint);
    }
    throw new ServiceHistoryDataError();
  } catch (cause) {
    if (cause instanceof ServiceHistoryDataError) throw cause;
    throw new ServiceHistoryDataError();
  }
}

export function validateServiceHistoryRange(
  resolution: HistoryResolution,
  from: number,
  to: number,
): void {
  const maximumRange =
    resolution === "raw" ? 86_400_000 : resolution === "5m" ? 7 * 86_400_000 : 31 * 86_400_000;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to - from > maximumRange
  ) {
    throw new ServiceHistoryRangeError();
  }
}

function validatedCursor(
  value: string | null,
  resolution: HistoryResolution,
  from: number,
  to: number,
): number | null {
  try {
    const last = decodeHistoryCursor(value, resolution);
    if (last !== null && (last < from - 300_000 || last >= to)) {
      throw new ServiceHistoryRangeError();
    }
    return last;
  } catch (cause) {
    if (cause instanceof ServiceHistoryRangeError) throw cause;
    if (cause instanceof HistoryCursorError) throw new ServiceHistoryRangeError();
    throw cause;
  }
}

async function loadAuthorizedCheckScope(
  controlDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  checkId: string,
): Promise<{ workspacePk: number; checkPk: number }> {
  const service = await loadAuthorizedServiceScope(controlDb, workspaceSlug, userId, serviceId);
  const check = await controlDb
    .prepare(
      `SELECT telemetry_pk FROM check_configs
       WHERE workspace_id = ? AND service_id = ? AND id = ?`,
    )
    .bind(service.workspaceId, serviceId, checkId)
    .first<{ telemetry_pk: number }>();
  if (!check) throw new ServiceNotFoundError();
  return { workspacePk: service.workspacePk, checkPk: check.telemetry_pk };
}

export async function loadServiceHistory(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  resolution: ServiceHistoryResolution,
  from: number,
  to: number,
  cursor: string | null = null,
): Promise<ServiceHistoryPage> {
  const scope = await loadAuthorizedServiceScope(controlDb, workspaceSlug, userId, serviceId);
  validateServiceHistoryRange(resolution, from, to);
  const after = validatedCursor(cursor, resolution, from, to);
  const bucketExpression = "CAST(bucket_start / 3600000 AS INTEGER) * 3600000";
  const query =
    resolution === "5m"
      ? `SELECT bucket_start, state, NULL AS state_rank, availability_permille,
            latency_avg_ms, latency_max_ms, summary_code
         FROM status_buckets
         WHERE resource_type = 2 AND resource_pk = ? AND bucket_seconds = 300
           AND workspace_pk = ? AND bucket_start >= ? AND bucket_start < ?
           ${after === null ? "" : "AND bucket_start > ?"}
         ORDER BY bucket_start LIMIT ?`
      : `SELECT ${bucketExpression} AS bucket_start, NULL AS state,
            MAX(CASE state WHEN 'maintenance' THEN 4 WHEN 'down' THEN 3
              WHEN 'degraded' THEN 2 WHEN 'healthy' THEN 1 ELSE 0 END) AS state_rank,
            ROUND(AVG(availability_permille)) AS availability_permille,
            ROUND(AVG(latency_avg_ms)) AS latency_avg_ms,
            MAX(latency_max_ms) AS latency_max_ms, NULL AS summary_code
         FROM status_buckets
         WHERE resource_type = 2 AND resource_pk = ? AND bucket_seconds = 300
           AND workspace_pk = ? AND bucket_start >= ? AND bucket_start < ?
         GROUP BY ${bucketExpression}
         ${after === null ? "" : `HAVING ${bucketExpression} > ?`}
         ORDER BY bucket_start LIMIT ?`;
  const bindings =
    after === null
      ? [scope.servicePk, scope.workspacePk, from, to, ROLLUP_PAGE_SIZE + 1]
      : [scope.servicePk, scope.workspacePk, from, to, after, ROLLUP_PAGE_SIZE + 1];
  const rows = await telemetryDb
    .prepare(query)
    .bind(...bindings)
    .all<ServiceHistoryRow>();
  const pageRows = rows.results.slice(0, ROLLUP_PAGE_SIZE);
  const last = pageRows.at(-1)?.bucket_start ?? null;
  return {
    points: pageRows.map((row) => ({
      bucketStart: row.bucket_start,
      state: monitorState(row.state, row.state_rank),
      availabilityPermille: row.availability_permille,
      latencyAverageMs: row.latency_avg_ms,
      latencyMaxMs: row.latency_max_ms,
      summaryCode: row.summary_code,
    })),
    nextCursor:
      rows.results.length > ROLLUP_PAGE_SIZE && last !== null
        ? encodeHistoryCursor(resolution, last)
        : null,
  };
}

async function loadRawCheckHistory(
  telemetryDb: D1Database,
  workspacePk: number,
  checkPk: number,
  from: number,
  to: number,
  after: number | null,
): Promise<CheckHistoryPage> {
  const blockFrom = Math.floor(from / 300_000) * 300_000;
  const query = `SELECT block_start, result_0, result_1, result_2, result_3, result_4
    FROM check_result_blocks_5m
    WHERE workspace_pk = ? AND check_pk = ? AND block_start >= ? AND block_start < ?
      ${after === null ? "" : "AND block_start > ?"}
    ORDER BY block_start LIMIT ?`;
  const bindings =
    after === null
      ? [workspacePk, checkPk, blockFrom, to, RAW_BLOCK_PAGE_SIZE + 1]
      : [workspacePk, checkPk, blockFrom, to, after, RAW_BLOCK_PAGE_SIZE + 1];
  const rows = await telemetryDb
    .prepare(query)
    .bind(...bindings)
    .all<CheckBlockRow>();
  const points: RawCheckHistoryPoint[] = [];
  let payloadBytes = 0;
  let processedRows = 0;
  try {
    for (const row of rows.results.slice(0, RAW_BLOCK_PAGE_SIZE)) {
      const payloads = [row.result_0, row.result_1, row.result_2, row.result_3, row.result_4]
        .filter((payload) => payload !== null && payload !== undefined)
        .map(d1BlobToArrayBuffer);
      const blockBytes = payloads.reduce((total, payload) => total + payload.byteLength, 0);
      if (processedRows > 0 && payloadBytes + blockBytes > RAW_PAYLOAD_PAGE_BYTES) break;
      payloadBytes += blockBytes;
      for (const payload of payloads) {
        for (const point of decodeStoredCheckHistoryPayload(payload)) {
          if (point.observedAt >= from && point.observedAt < to) points.push(point);
          if (points.length > RAW_POINT_LIMIT) throw new ServiceHistoryDataError();
        }
      }
      processedRows += 1;
    }
  } catch (cause) {
    if (cause instanceof ServiceHistoryDataError) throw cause;
    throw new ServiceHistoryDataError();
  }
  points.sort((left, right) => left.observedAt - right.observedAt);
  const last = processedRows > 0 ? rows.results[processedRows - 1]?.block_start : null;
  return {
    points,
    nextCursor:
      processedRows < rows.results.length && typeof last === "number"
        ? encodeHistoryCursor("raw", last)
        : null,
  };
}

export async function loadServiceCheckHistory(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  checkId: string,
  resolution: HistoryResolution,
  from: number,
  to: number,
  cursor: string | null = null,
): Promise<CheckHistoryPage> {
  const scope = await loadAuthorizedCheckScope(
    controlDb,
    workspaceSlug,
    userId,
    serviceId,
    checkId,
  );
  validateServiceHistoryRange(resolution, from, to);
  const after = validatedCursor(cursor, resolution, from, to);
  if (resolution === "raw") {
    return loadRawCheckHistory(telemetryDb, scope.workspacePk, scope.checkPk, from, to, after);
  }
  const table = resolution === "5m" ? "check_rollups_5m" : "check_rollups_1h";
  const query = `SELECT bucket_start, total_count, healthy_count, degraded_count, down_count,
      latency_avg_ms, latency_max_ms
    FROM ${table}
    WHERE workspace_pk = ? AND check_pk = ? AND bucket_start >= ? AND bucket_start < ?
      ${after === null ? "" : "AND bucket_start > ?"}
    ORDER BY bucket_start LIMIT ?`;
  const bindings =
    after === null
      ? [scope.workspacePk, scope.checkPk, from, to, ROLLUP_PAGE_SIZE + 1]
      : [scope.workspacePk, scope.checkPk, from, to, after, ROLLUP_PAGE_SIZE + 1];
  const rows = await telemetryDb
    .prepare(query)
    .bind(...bindings)
    .all<CheckRollupRow>();
  const pageRows = rows.results.slice(0, ROLLUP_PAGE_SIZE);
  const last = pageRows.at(-1)?.bucket_start ?? null;
  return {
    points: pageRows.map((row) => ({
      kind: "rollup",
      bucketStart: row.bucket_start,
      totalCount: row.total_count,
      healthyCount: row.healthy_count,
      degradedCount: row.degraded_count,
      downCount: row.down_count,
      unknownCount: Math.max(
        0,
        row.total_count - row.healthy_count - row.degraded_count - row.down_count,
      ),
      latencyAverageMs: row.latency_avg_ms,
      latencyMaxMs: row.latency_max_ms,
    })),
    nextCursor:
      rows.results.length > ROLLUP_PAGE_SIZE && last !== null
        ? encodeHistoryCursor(resolution, last)
        : null,
  };
}
