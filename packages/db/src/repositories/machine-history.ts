import { d1BlobToArrayBuffer, decodeCompressedMachineSamples } from "@alphaping/contracts";

import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  HistoryCursorError,
  type HistoryResolution,
} from "./history-cursor.js";
import { loadAuthorizedMachineScope } from "./machines.js";

const ROLLUP_PAGE_SIZE = 744;
const RAW_BLOCK_PAGE_SIZE = 72;
const RAW_POINT_LIMIT = 2_160;
const RAW_COMPRESSED_PAGE_BYTES = 4 * 1024 * 1024;

interface HistoryRow {
  bucket_start: number;
  sample_count: number;
  cpu_avg_permille: number;
  cpu_max_permille: number;
  memory_avg_bytes: number;
  storage_max_bytes: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
}

interface RawBlockRow {
  block_start: number;
  report_0: unknown;
  report_1: unknown;
  report_2: unknown;
  report_3: unknown;
  report_4: unknown;
}

export interface MachineHistoryPoint {
  bucketStart: number;
  sampleCount: number;
  cpuAveragePermille: number;
  cpuMaxPermille: number;
  memoryAverageBytes: number;
  memoryTotalBytes: number | null;
  storageMaxBytes: number;
  storageTotalBytes: number | null;
  networkRxBytes: number;
  networkTxBytes: number;
  networkRxBps: number | null;
  networkTxBps: number | null;
  load1mMilli: number | null;
  uptimeSeconds: number | null;
}

export interface MachineHistoryPage {
  points: readonly MachineHistoryPoint[];
  nextCursor: string | null;
}

export class MachineHistoryRangeError extends Error {}
export class MachineHistoryDataError extends Error {}

export function validateMachineHistoryRange(
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
    throw new MachineHistoryRangeError();
  }
}

function validateCursor(
  cursor: string | null,
  resolution: HistoryResolution,
  from: number,
  to: number,
): number | null {
  try {
    const last = decodeHistoryCursor(cursor, resolution);
    if (last !== null && (last < from - 300_000 || last >= to)) {
      throw new MachineHistoryRangeError();
    }
    return last;
  } catch (cause) {
    if (cause instanceof MachineHistoryRangeError) throw cause;
    if (cause instanceof HistoryCursorError) throw new MachineHistoryRangeError();
    throw cause;
  }
}

function rollupPoint(row: HistoryRow): MachineHistoryPoint {
  return {
    bucketStart: row.bucket_start,
    sampleCount: row.sample_count,
    cpuAveragePermille: row.cpu_avg_permille,
    cpuMaxPermille: row.cpu_max_permille,
    memoryAverageBytes: row.memory_avg_bytes,
    memoryTotalBytes: null,
    storageMaxBytes: row.storage_max_bytes,
    storageTotalBytes: null,
    networkRxBytes: row.network_rx_bytes,
    networkTxBytes: row.network_tx_bytes,
    networkRxBps: null,
    networkTxBps: null,
    load1mMilli: null,
    uptimeSeconds: null,
  };
}

async function loadRawHistory(
  telemetryDb: D1Database,
  workspacePk: number,
  machinePk: number,
  from: number,
  to: number,
  after: number | null,
): Promise<MachineHistoryPage> {
  const blockFrom = Math.floor(from / 300_000) * 300_000;
  const query = `SELECT block_start, report_0, report_1, report_2, report_3, report_4
    FROM telemetry_blocks_5m
    WHERE workspace_pk = ? AND machine_pk = ? AND block_start >= ? AND block_start < ?
      ${after === null ? "" : "AND block_start > ?"}
    ORDER BY block_start LIMIT ?`;
  const bindings =
    after === null
      ? [workspacePk, machinePk, blockFrom, to, RAW_BLOCK_PAGE_SIZE + 1]
      : [workspacePk, machinePk, blockFrom, to, after, RAW_BLOCK_PAGE_SIZE + 1];
  const rows = await telemetryDb
    .prepare(query)
    .bind(...bindings)
    .all<RawBlockRow>();
  const points: MachineHistoryPoint[] = [];
  let compressedBytes = 0;
  let processedRows = 0;

  try {
    for (const row of rows.results.slice(0, RAW_BLOCK_PAGE_SIZE)) {
      const reports = [row.report_0, row.report_1, row.report_2, row.report_3, row.report_4]
        .filter((report) => report !== null && report !== undefined)
        .map(d1BlobToArrayBuffer);
      const blockBytes = reports.reduce((total, report) => total + report.byteLength, 0);
      if (processedRows > 0 && compressedBytes + blockBytes > RAW_COMPRESSED_PAGE_BYTES) break;
      compressedBytes += blockBytes;
      for (const report of reports) {
        const samples = await decodeCompressedMachineSamples(report);
        for (const sample of samples) {
          if (sample.observedAt < from || sample.observedAt >= to) continue;
          points.push({
            bucketStart: sample.observedAt,
            sampleCount: 1,
            cpuAveragePermille: sample.cpuPermille,
            cpuMaxPermille: sample.cpuPermille,
            memoryAverageBytes: sample.memoryUsedBytes,
            memoryTotalBytes: sample.memoryTotalBytes,
            storageMaxBytes: sample.storageUsedBytes,
            storageTotalBytes: sample.storageTotalBytes,
            networkRxBytes: 0,
            networkTxBytes: 0,
            networkRxBps: sample.networkRxBps,
            networkTxBps: sample.networkTxBps,
            load1mMilli: sample.load1mMilli,
            uptimeSeconds: sample.uptimeSeconds,
          });
          if (points.length > RAW_POINT_LIMIT) throw new MachineHistoryDataError();
        }
      }
      processedRows += 1;
    }
  } catch (cause) {
    if (cause instanceof MachineHistoryDataError) throw cause;
    throw new MachineHistoryDataError();
  }

  points.sort((left, right) => left.bucketStart - right.bucketStart);
  const hasMore = processedRows < rows.results.length;
  const lastProcessed = processedRows > 0 ? rows.results[processedRows - 1]?.block_start : null;
  return {
    points,
    nextCursor:
      hasMore && typeof lastProcessed === "number"
        ? encodeHistoryCursor("raw", lastProcessed)
        : null,
  };
}

export async function loadMachineHistory(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
  resolution: HistoryResolution,
  from: number,
  to: number,
  cursor: string | null = null,
): Promise<MachineHistoryPage> {
  const scope = await loadAuthorizedMachineScope(controlDb, workspaceSlug, userId, machineId);
  validateMachineHistoryRange(resolution, from, to);
  const after = validateCursor(cursor, resolution, from, to);
  if (resolution === "raw") {
    return loadRawHistory(telemetryDb, scope.workspacePk, scope.machinePk, from, to, after);
  }

  const table = resolution === "5m" ? "machine_rollups_5m" : "machine_rollups_1h";
  const query = `SELECT bucket_start, sample_count, cpu_avg_permille, cpu_max_permille,
      memory_avg_bytes, storage_max_bytes, network_rx_bytes, network_tx_bytes
    FROM ${table}
    WHERE workspace_pk = ? AND machine_pk = ? AND bucket_start >= ? AND bucket_start < ?
      ${after === null ? "" : "AND bucket_start > ?"}
    ORDER BY bucket_start LIMIT ?`;
  const bindings =
    after === null
      ? [scope.workspacePk, scope.machinePk, from, to, ROLLUP_PAGE_SIZE + 1]
      : [scope.workspacePk, scope.machinePk, from, to, after, ROLLUP_PAGE_SIZE + 1];
  const rows = await telemetryDb
    .prepare(query)
    .bind(...bindings)
    .all<HistoryRow>();
  const pageRows = rows.results.slice(0, ROLLUP_PAGE_SIZE);
  const last = pageRows.at(-1)?.bucket_start ?? null;
  return {
    points: pageRows.map(rollupPoint),
    nextCursor:
      rows.results.length > ROLLUP_PAGE_SIZE && last !== null
        ? encodeHistoryCursor(resolution, last)
        : null,
  };
}
