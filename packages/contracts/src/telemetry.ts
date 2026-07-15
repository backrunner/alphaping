export const SAMPLE_INTERVAL_SECONDS = 10;
export const REPORT_INTERVAL_SECONDS = 60;
export const REPORTS_PER_BLOCK = 5;
export const BLOCK_INTERVAL_MS = REPORT_INTERVAL_SECONDS * REPORTS_PER_BLOCK * 1_000;
export const MAX_DURABLE_ENVELOPE_BYTES = 64 * 1024;

export type HealthState = "healthy" | "degraded" | "down" | "unknown";
export type MachineState = HealthState | "offline" | "maintenance";

export interface MetricSample {
  observedAt: number;
  cpuPermille: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  storageUsedBytes: number;
  storageTotalBytes: number;
  networkRxBytesPerSecond: number;
  networkTxBytesPerSecond: number;
  networkRxBytesTotal: number;
  networkTxBytesTotal: number;
}

export interface MachineReport {
  reportId: string;
  machinePk: number;
  workspacePk: number;
  nominalMinute: number;
  samples: readonly MetricSample[];
}

export interface CheckResult {
  resultId: string;
  checkPk: number;
  workspacePk: number;
  nominalMinute: number;
  observedAt: number;
  state: HealthState;
  latencyMs: number | null;
  failureCode: string | null;
}

export function floorToMinute(timestampMs: number): number {
  return Math.floor(timestampMs / 60_000) * 60_000;
}

export function floorToFiveMinuteBlock(timestampMs: number): number {
  return Math.floor(timestampMs / BLOCK_INTERVAL_MS) * BLOCK_INTERVAL_MS;
}

export function reportSlot(timestampMs: number): 0 | 1 | 2 | 3 | 4 {
  const slot = Math.floor(
    (floorToMinute(timestampMs) - floorToFiveMinuteBlock(timestampMs)) / 60_000,
  );
  if (slot < 0 || slot >= REPORTS_PER_BLOCK) {
    throw new RangeError(`invalid report slot: ${slot}`);
  }
  return slot as 0 | 1 | 2 | 3 | 4;
}
