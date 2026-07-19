import type { WorkspaceRole } from "@alphaping/authz";

import type { MachineProbeTask } from "./machine-models.js";
import { resourceCapabilityCondition } from "./resource-access-query.js";

interface ProbeConfigRow {
  id: string;
  telemetry_pk: number;
  service_id: string;
  service_name: string;
  name: string;
  kind: MachineProbeTask["kind"];
  interval_seconds: number;
  timeout_ms: number;
  assignment_revision: number;
  request_json: string;
}

interface ProbeLatestRow {
  check_pk: number;
  observed_at: number;
  state: string;
  latency_ms: number | null;
  failure_code: string | null;
}

interface ProbeRollupRow {
  check_pk: number;
  bucket_start: number;
  total_count: number;
  healthy_count: number;
  degraded_count: number;
  down_count: number;
  latency_avg_ms: number | null;
  latency_max_ms: number | null;
}

export interface MachineProbeAccess {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function probeState(state: string): NonNullable<MachineProbeTask["latest"]>["state"] {
  return state === "healthy" || state === "degraded" || state === "down" ? state : "unknown";
}

export function parseProbeTarget(kind: MachineProbeTask["kind"], requestJson: string): string {
  try {
    const parsed: unknown = JSON.parse(requestJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Invalid target";
    const request = parsed as Readonly<Record<string, unknown>>;
    if (kind === "http" && typeof request.url === "string") {
      const url = new URL(request.url);
      return `${url.protocol}//${url.host}${url.pathname}`;
    }
    if (typeof request.hostname !== "string" || request.hostname.length === 0) {
      return "Invalid target";
    }
    return kind === "tcp" && Number.isInteger(request.port)
      ? `${request.hostname}:${String(request.port)}`
      : request.hostname;
  } catch {
    return "Invalid target";
  }
}

export async function loadMachineProbeTasks(
  controlDb: D1Database,
  telemetryDb: D1Database,
  access: MachineProbeAccess,
  agentId: string | null,
  now: number,
): Promise<readonly MachineProbeTask[]> {
  if (!agentId) return [];
  const authorization = resourceCapabilityCondition(access, "service", "s.id", "view");
  const configured = (
    await controlDb
      .prepare(
        `SELECT c.id, c.telemetry_pk, s.id AS service_id, s.name AS service_name,
                c.name, c.kind, c.interval_seconds, c.timeout_ms,
                c.assignment_revision, c.request_json
         FROM check_configs c JOIN services s ON s.id = c.service_id
         WHERE c.executor_kind = 'agent' AND c.executor_agent_id = ? AND c.enabled = 1
           AND c.workspace_id = ? AND s.deleted_at IS NULL
           AND (${authorization.sql})
         ORDER BY s.name, c.name LIMIT 32`,
      )
      .bind(agentId, access.workspaceId, ...authorization.binds)
      .all<ProbeConfigRow>()
  ).results;
  if (configured.length === 0) return [];
  const checkPks = configured.map((task) => task.telemetry_pk);
  const values = placeholders(checkPks.length);
  const [latest, rollups] = await Promise.all([
    telemetryDb
      .prepare(
        `SELECT check_pk, observed_at, state, latency_ms, failure_code
         FROM check_latest WHERE check_pk IN (${values})`,
      )
      .bind(...checkPks)
      .all<ProbeLatestRow>(),
    telemetryDb
      .prepare(
        `SELECT check_pk, bucket_start, total_count, healthy_count, degraded_count,
                down_count, latency_avg_ms, latency_max_ms
         FROM check_rollups_5m
         WHERE check_pk IN (${values}) AND bucket_start >= ?
         ORDER BY bucket_start`,
      )
      .bind(...checkPks, now - 60 * 60_000)
      .all<ProbeRollupRow>(),
  ]);
  const latestByPk = new Map(latest.results.map((row) => [row.check_pk, row]));
  const rollupsByPk = new Map<number, ProbeRollupRow[]>();
  for (const row of rollups.results) {
    const group = rollupsByPk.get(row.check_pk) ?? [];
    group.push(row);
    rollupsByPk.set(row.check_pk, group);
  }
  return configured.map((task) => {
    const current = latestByPk.get(task.telemetry_pk);
    return {
      id: task.id,
      serviceId: task.service_id,
      serviceName: task.service_name,
      name: task.name,
      kind: task.kind,
      target: parseProbeTarget(task.kind, task.request_json),
      intervalSeconds: task.interval_seconds,
      timeoutMs: task.timeout_ms,
      assignmentRevision: task.assignment_revision,
      latest: current
        ? {
            observedAt: current.observed_at,
            state: probeState(current.state),
            latencyMs: current.latency_ms,
            failureCode: current.failure_code,
          }
        : null,
      history: (rollupsByPk.get(task.telemetry_pk) ?? []).map((row) => ({
        bucketStart: row.bucket_start,
        state:
          row.down_count > 0
            ? "down"
            : row.degraded_count > 0
              ? "degraded"
              : row.healthy_count > 0
                ? "healthy"
                : "unknown",
        availabilityPermille:
          row.total_count === 0 ? 0 : Math.round((row.healthy_count / row.total_count) * 1_000),
        latencyAvgMs: row.latency_avg_ms,
        latencyMaxMs: row.latency_max_ms,
      })),
    };
  });
}
