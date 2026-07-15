import type { MonitorState, ServiceTimelineBucket } from "./service-models.js";

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
