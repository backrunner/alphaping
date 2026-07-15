import { loadAuthorizedMachineScope } from "./machines.js";

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

export interface MachineHistoryPoint {
  bucketStart: number;
  sampleCount: number;
  cpuAveragePermille: number;
  cpuMaxPermille: number;
  memoryAverageBytes: number;
  storageMaxBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export class MachineHistoryRangeError extends Error {}

export function validateMachineHistoryRange(
  resolution: "5m" | "1h",
  from: number,
  to: number,
): void {
  const maximumRange = resolution === "5m" ? 7 * 86_400_000 : 31 * 86_400_000;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    to <= from ||
    to - from > maximumRange
  ) {
    throw new MachineHistoryRangeError();
  }
}

export async function loadMachineHistory(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
  resolution: "5m" | "1h",
  from: number,
  to: number,
): Promise<readonly MachineHistoryPoint[]> {
  const scope = await loadAuthorizedMachineScope(controlDb, workspaceSlug, userId, machineId);
  validateMachineHistoryRange(resolution, from, to);
  const table = resolution === "5m" ? "machine_rollups_5m" : "machine_rollups_1h";
  const rows = await telemetryDb
    .prepare(
      `SELECT bucket_start, sample_count, cpu_avg_permille, cpu_max_permille,
              memory_avg_bytes, storage_max_bytes, network_rx_bytes, network_tx_bytes
       FROM ${table}
       WHERE workspace_pk = ? AND machine_pk = ? AND bucket_start >= ? AND bucket_start < ?
       ORDER BY bucket_start LIMIT 744`,
    )
    .bind(scope.workspacePk, scope.machinePk, from, to)
    .all<HistoryRow>();
  return rows.results.map((row) => ({
    bucketStart: row.bucket_start,
    sampleCount: row.sample_count,
    cpuAveragePermille: row.cpu_avg_permille,
    cpuMaxPermille: row.cpu_max_permille,
    memoryAverageBytes: row.memory_avg_bytes,
    storageMaxBytes: row.storage_max_bytes,
    networkRxBytes: row.network_rx_bytes,
    networkTxBytes: row.network_tx_bytes,
  }));
}
