import type { MachineState } from "@alphaping/contracts";

import type { MachineContainerInventory } from "./machine-models.js";
import type { MonitorState, ServiceTimelineBucket } from "./service-models.js";

export interface PublicMachineRow {
  id: string;
  telemetry_pk: number;
  name: string;
  description: string;
  offline_after_seconds: number;
  projection_profile: "summary" | "detailed";
}

export interface PublicMachineLatestRow {
  machine_pk: number;
  observed_at: number;
  received_at: number;
  state: string;
  cpu_permille: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  storage_used_bytes: number;
  storage_total_bytes: number;
  network_rx_bps: number;
  network_tx_bps: number;
  container_inventory_json: string | null;
}

export interface PublicContainerRow {
  id: string;
  machine_id: string;
  projection_profile: "summary" | "detailed";
}

export interface PublicStatusMachine {
  name: string;
  description: string;
  state: MachineState;
  observedAt: number | null;
  cpuPermille: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  storageUsedBytes: number | null;
  storageTotalBytes: number | null;
  networkRxBps: number | null;
  networkTxBps: number | null;
  containers: readonly {
    name: string;
    state: string;
    health: string;
    cpuPermille: number | null;
    memoryUsedBytes: number | null;
  }[];
}

export interface PublicServiceRow {
  id: string;
  telemetry_pk: number;
  name: string;
  slug: string | null;
  description: string;
  projection_profile: "summary" | "detailed";
}

export interface PublicServiceLatestRow {
  service_pk: number;
  state: string;
  last_transition_at: number;
}

export interface PublicStatusBucketRow {
  resource_pk: number;
  bucket_start: number;
  state: string;
  availability_permille: number;
  latency_avg_ms: number | null;
  summary_code: string;
}

export interface PublicStatusService {
  name: string;
  slug: string;
  description: string;
  state: MonitorState;
  lastCheckedAt: number | null;
  lastTransitionAt: number | null;
  availability24hPermille: number | null;
  timeline: readonly ServiceTimelineBucket[];
}

function normalizeState(value: string): MonitorState {
  if (value === "healthy" || value === "degraded" || value === "down" || value === "maintenance") {
    return value;
  }
  return "unknown";
}

function normalizeMachineState(value: string): MachineState {
  if (
    value === "healthy" ||
    value === "degraded" ||
    value === "down" ||
    value === "offline" ||
    value === "maintenance"
  ) {
    return value;
  }
  return "unknown";
}

export function projectPublicStatusMachine(input: {
  machine: PublicMachineRow;
  latest: PublicMachineLatestRow | undefined;
  inventory: MachineContainerInventory | null;
  publicContainers: readonly PublicContainerRow[];
  now: number;
}): PublicStatusMachine {
  const detailed = input.machine.projection_profile === "detailed";
  const stale = input.latest
    ? input.now - input.latest.received_at > input.machine.offline_after_seconds * 1_000
    : false;
  const containerById = new Map(
    (input.inventory?.containers ?? []).map((container) => [container.id, container]),
  );
  return {
    name: input.machine.name,
    description: detailed ? input.machine.description : "",
    state: input.latest
      ? stale
        ? "offline"
        : normalizeMachineState(input.latest.state)
      : "unknown",
    observedAt: input.latest?.observed_at ?? null,
    cpuPermille: detailed ? (input.latest?.cpu_permille ?? null) : null,
    memoryUsedBytes: detailed ? (input.latest?.memory_used_bytes ?? null) : null,
    memoryTotalBytes: detailed ? (input.latest?.memory_total_bytes ?? null) : null,
    storageUsedBytes: detailed ? (input.latest?.storage_used_bytes ?? null) : null,
    storageTotalBytes: detailed ? (input.latest?.storage_total_bytes ?? null) : null,
    networkRxBps: detailed ? (input.latest?.network_rx_bps ?? null) : null,
    networkTxBps: detailed ? (input.latest?.network_tx_bps ?? null) : null,
    containers: input.publicContainers.flatMap((policy) => {
      const container = containerById.get(policy.id);
      if (!container) return [];
      const containerDetailed = policy.projection_profile === "detailed";
      return [
        {
          name: container.name,
          state: container.state,
          health: container.health,
          cpuPermille: containerDetailed ? container.cpuPermille : null,
          memoryUsedBytes: containerDetailed ? container.memoryUsedBytes : null,
        },
      ];
    }),
  };
}

function stateRank(state: MonitorState): number {
  return { unknown: 0, healthy: 1, degraded: 2, down: 3, maintenance: 4 }[state];
}

function buildTimeline(
  servicePk: number,
  buckets: readonly PublicStatusBucketRow[],
  now: number,
): readonly ServiceTimelineBucket[] {
  const bucketMs = 30 * 60_000;
  const count = 48;
  const end = Math.floor(now / bucketMs) * bucketMs + bucketMs;
  const start = end - count * bucketMs;
  return Array.from({ length: count }, (_, index) => {
    const bucketStart = start + index * bucketMs;
    const rows = buckets.filter(
      (row) =>
        row.resource_pk === servicePk &&
        row.bucket_start >= bucketStart &&
        row.bucket_start < bucketStart + bucketMs,
    );
    const state = rows.reduce<MonitorState>((worst, row) => {
      const candidate = normalizeState(row.state);
      return stateRank(candidate) > stateRank(worst) ? candidate : worst;
    }, "unknown");
    const availability =
      rows.length === 0
        ? null
        : Math.round(rows.reduce((sum, row) => sum + row.availability_permille, 0) / rows.length);
    const latencyRows = rows.flatMap((row) =>
      row.latency_avg_ms === null ? [] : [row.latency_avg_ms],
    );
    return {
      bucketStart,
      state,
      availabilityPermille: availability,
      latencyMs:
        latencyRows.length === 0
          ? null
          : Math.round(latencyRows.reduce((sum, value) => sum + value, 0) / latencyRows.length),
      summaryCode: rows.find((row) => normalizeState(row.state) === state)?.summary_code ?? null,
    };
  });
}

export function projectPublicStatusService(input: {
  service: PublicServiceRow;
  latest: PublicServiceLatestRow | undefined;
  lastCheckedAt: number | null;
  buckets: readonly PublicStatusBucketRow[];
  now: number;
}): PublicStatusService {
  const serviceBuckets = input.buckets.filter(
    (row) => row.resource_pk === input.service.telemetry_pk,
  );
  return {
    name: input.service.name,
    slug: input.service.slug ?? input.service.id,
    description: input.service.projection_profile === "detailed" ? input.service.description : "",
    state: input.latest ? normalizeState(input.latest.state) : "unknown",
    lastCheckedAt: input.lastCheckedAt,
    lastTransitionAt: input.latest?.last_transition_at ?? null,
    availability24hPermille:
      serviceBuckets.length === 0
        ? null
        : Math.round(
            serviceBuckets.reduce((sum, row) => sum + row.availability_permille, 0) /
              serviceBuckets.length,
          ),
    timeline: buildTimeline(input.service.telemetry_pk, input.buckets, input.now),
  };
}
