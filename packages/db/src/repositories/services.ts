import { canAccessResource } from "@alphaping/authz";

import { queryInBatches } from "./d1-query-batches.js";
import type {
  CheckLatestRow,
  CheckRow,
  EventRow,
  GrantRow,
  MonitorState,
  ServiceCollection,
  ServiceCheckEditConfiguration,
  ServiceDetail,
  ServiceLatestRow,
  ServiceRow,
  ServiceSummary,
  ServiceTimelineBucket,
  StatusBucketRow,
  WorkspaceAccess,
  WorkspaceRow,
} from "./service-models.js";

export type {
  MonitorState,
  ServiceCheckEditConfiguration,
  ServiceCheckSummary,
  ServiceCollection,
  ServiceDetail,
  ServiceSummary,
  ServiceTimelineBucket,
} from "./service-models.js";

export class ServiceNotFoundError extends Error {}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function normalizeState(state: string): MonitorState {
  if (state === "healthy" || state === "degraded" || state === "down" || state === "maintenance")
    return state;
  return "unknown";
}

function stateRank(state: MonitorState): number {
  return { unknown: 0, healthy: 1, degraded: 2, down: 3, maintenance: 4 }[state];
}

async function loadWorkspaceAccess(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<WorkspaceAccess> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, w.telemetry_pk, m.role
     FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
     WHERE w.slug = ? AND w.deleted_at IS NULL AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, userId)
    .first<WorkspaceRow>();
  if (!workspace) throw new ServiceNotFoundError();
  const rows = await db
    .prepare(
      `SELECT resource_type, resource_id, capability, effect FROM resource_grants
     WHERE workspace_id = ? AND subject_user_id = ?
       AND resource_type IN ('service', 'incident')`,
    )
    .bind(workspace.id, userId)
    .all<GrantRow>();
  return {
    workspace,
    grants: rows.results.map((grant) => ({
      resourceType: grant.resource_type,
      resourceId: grant.resource_id,
      capability: grant.capability,
      effect: grant.effect,
    })),
  };
}

async function loadServiceRows(
  db: D1Database,
  workspaceId: string,
): Promise<readonly ServiceRow[]> {
  return (
    await db
      .prepare(
        `SELECT id, telemetry_pk, name, slug, description, maintenance_until, created_at
     FROM services WHERE workspace_id = ? AND deleted_at IS NULL
     ORDER BY name LIMIT 200`,
      )
      .bind(workspaceId)
      .all<ServiceRow>()
  ).results;
}

async function loadServiceRow(
  db: D1Database,
  workspaceId: string,
  serviceId: string,
): Promise<ServiceRow | null> {
  return db
    .prepare(
      `SELECT id, telemetry_pk, name, slug, description, maintenance_until, created_at
       FROM services WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
    )
    .bind(workspaceId, serviceId)
    .first<ServiceRow>();
}

async function loadCheckRows(db: D1Database, workspaceId: string): Promise<readonly CheckRow[]> {
  return (
    await db
      .prepare(
        `SELECT id, telemetry_pk, service_id, name, kind, executor_kind, executor_agent_id, enabled,
            interval_seconds, timeout_ms, retry_count, critical, request_json,
            secret_refs_json, failure_confirmations, recovery_confirmations
     FROM check_configs WHERE workspace_id = ? ORDER BY service_id, created_at LIMIT 1000`,
      )
      .bind(workspaceId)
      .all<CheckRow>()
  ).results;
}

interface CheckAssertionRow {
  check_id: string;
  source: "header" | "jsonpath" | "body";
  operator: "exists" | "equals" | "contains" | "matches" | "type" | "greater_than" | "less_than";
  selector: string | null;
  expected_json: string;
  severity: "degraded" | "down";
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function nullableNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function decodeUtf8Base64(value: unknown): string {
  if (typeof value !== "string" || value.length > 8_192) return "";
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}

function expectedInput(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : parsed === null ? "" : JSON.stringify(parsed);
  } catch {
    return "";
  }
}

function editConfiguration(
  check: CheckRow,
  assertions: readonly CheckAssertionRow[],
): ServiceCheckEditConfiguration | null {
  try {
    const request = objectValue(JSON.parse(check.request_json) as unknown);
    const secrets = objectValue(JSON.parse(check.secret_refs_json) as unknown);
    if (!request || !secrets) return null;
    const headers = objectValue(request.headers) ?? {};
    const secretHeaders = objectValue(secrets.headers) ?? {};
    const expectedStatus = Array.isArray(request.expectedStatus)
      ? request.expectedStatus.filter(
          (status): status is number => typeof status === "number" && Number.isInteger(status),
        )
      : [];
    return {
      executorAgentId: check.executor_agent_id,
      url: stringValue(request.url),
      method: stringValue(request.method, "GET"),
      expectedStatuses: expectedStatus.join(", ") || "200",
      maxRedirects: numberValue(request.maxRedirects, 3),
      tlsVerify: request.tlsVerify !== false,
      degradedAfterMs: nullableNumberValue(request.degradedAfterMs),
      downAfterMs: nullableNumberValue(request.downAfterMs),
      maxResponseBytes: numberValue(request.maxResponseBytes, 65_536),
      requestHeaders: Object.entries(headers)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([name, value]) => `${name}: ${value}`)
        .join("\n"),
      requestBody: stringValue(request.body),
      hostname: stringValue(request.hostname),
      serverName: stringValue(request.serverName),
      port: nullableNumberValue(request.port),
      useTls: request.secureTransport === "on",
      tcpPayload: decodeUtf8Base64(request.payloadBase64),
      tcpResponsePrefix: decodeUtf8Base64(request.responsePrefixBase64),
      assertions: assertions
        .filter((assertion) => assertion.check_id === check.id)
        .map((assertion) => ({
          source: assertion.source,
          operator: assertion.operator,
          selector: assertion.selector ?? "",
          expected: expectedInput(assertion.expected_json),
          severity: assertion.severity,
        })),
      secretHeaderNames: Object.entries(secretHeaders)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([name]) => name)
        .sort(),
      hasSecretBody: typeof secrets.body === "string" && secrets.body.length > 0,
      hasSecretTcpPayload: typeof secrets.tcpPayload === "string" && secrets.tcpPayload.length > 0,
    };
  } catch {
    return null;
  }
}

function timelineForService(
  servicePk: number,
  rows: readonly StatusBucketRow[],
  now: number,
  bucketSeconds = 1_800,
  bucketCount = 48,
): readonly ServiceTimelineBucket[] {
  const bucketMs = bucketSeconds * 1_000;
  const end = Math.floor(now / bucketMs) * bucketMs + bucketMs;
  const start = end - bucketCount * bucketMs;
  const groups = new Map<number, StatusBucketRow[]>();
  for (const row of rows) {
    if (row.resource_pk !== servicePk || row.bucket_start < start || row.bucket_start >= end)
      continue;
    const groupStart = Math.floor(row.bucket_start / bucketMs) * bucketMs;
    const group = groups.get(groupStart) ?? [];
    group.push(row);
    groups.set(groupStart, group);
  }
  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + index * bucketMs;
    const group = groups.get(bucketStart) ?? [];
    const state = group.reduce<MonitorState>((worst, row) => {
      const candidate = normalizeState(row.state);
      return stateRank(candidate) > stateRank(worst) ? candidate : worst;
    }, "unknown");
    const availability =
      group.length === 0
        ? null
        : Math.round(group.reduce((sum, row) => sum + row.availability_permille, 0) / group.length);
    const latencies = group.flatMap((row) =>
      row.latency_avg_ms === null ? [] : [row.latency_avg_ms],
    );
    return {
      bucketStart,
      state,
      availabilityPermille: availability,
      latencyMs:
        latencies.length === 0
          ? null
          : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      summaryCode: group.find((row) => normalizeState(row.state) === state)?.summary_code ?? null,
    };
  });
}

function sanitizedTarget(row: CheckRow): { target: string; assertionCount: number } {
  try {
    const parsed = JSON.parse(row.request_json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { target: "Invalid configuration", assertionCount: 0 };
    }
    const config = parsed as Readonly<Record<string, unknown>>;
    const assertionCount = Array.isArray(config.assertions) ? config.assertions.length : 0;
    if (row.kind === "http" && typeof config.url === "string") {
      const url = new URL(config.url);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return { target: url.toString(), assertionCount };
    }
    if ((row.kind === "tcp" || row.kind === "icmp") && typeof config.hostname === "string") {
      const port = typeof config.port === "number" ? `:${config.port}` : "";
      return { target: `${config.hostname}${port}`, assertionCount };
    }
    return { target: "Configured target", assertionCount };
  } catch {
    return { target: "Invalid configuration", assertionCount: 0 };
  }
}

async function loadTelemetry(
  db: D1Database,
  workspacePk: number,
  servicePks: readonly number[],
  checkPks: readonly number[],
  now: number,
): Promise<{
  services: readonly ServiceLatestRow[];
  checks: readonly CheckLatestRow[];
  buckets: readonly StatusBucketRow[];
}> {
  if (servicePks.length === 0) return { services: [], checks: [], buckets: [] };
  const since = now - 24 * 60 * 60_000;
  const [services, checks, buckets] = await Promise.all([
    queryInBatches<ServiceLatestRow, number>(db, servicePks, (batch) =>
      db
        .prepare(
          `SELECT service_pk, state, status_since, reason_code, last_transition_at
       FROM service_latest WHERE workspace_pk = ? AND service_pk IN (${placeholders(batch.length)})`,
        )
        .bind(workspacePk, ...batch),
    ),
    queryInBatches<CheckLatestRow, number>(db, checkPks, (batch) =>
      db
        .prepare(
          `SELECT check_pk, observed_at, state, latency_ms, failure_code, failure_summary,
                  consecutive_failures, consecutive_successes, critical
           FROM check_latest WHERE workspace_pk = ? AND check_pk IN (${placeholders(batch.length)})`,
        )
        .bind(workspacePk, ...batch),
    ),
    queryInBatches<StatusBucketRow, number>(db, servicePks, (batch) =>
      db
        .prepare(
          `SELECT resource_pk, bucket_start, state, availability_permille,
              latency_avg_ms, latency_max_ms, summary_code
       FROM status_buckets
       WHERE workspace_pk = ? AND resource_type = 2 AND bucket_seconds = 300
         AND resource_pk IN (${placeholders(batch.length)}) AND bucket_start >= ?
       ORDER BY bucket_start`,
        )
        .bind(workspacePk, ...batch, since),
    ),
  ]);
  return { services, checks, buckets };
}

function summarizeService(
  service: ServiceRow,
  checks: readonly CheckRow[],
  telemetry: Awaited<ReturnType<typeof loadTelemetry>>,
  canManage: boolean,
  now: number,
): ServiceSummary {
  const latestService = telemetry.services.find((row) => row.service_pk === service.telemetry_pk);
  const checkPks = new Set(checks.map((check) => check.telemetry_pk));
  const latestChecks = telemetry.checks.filter((check) => checkPks.has(check.check_pk));
  const fallbackState: MonitorState = latestChecks.some(
    (check) => check.critical === 1 && check.state === "down",
  )
    ? "down"
    : latestChecks.some((check) => check.state === "down" || check.state === "degraded")
      ? "degraded"
      : latestChecks.some((check) => check.state === "healthy")
        ? "healthy"
        : "unknown";
  const serviceBuckets = telemetry.buckets.filter(
    (row) => row.resource_pk === service.telemetry_pk,
  );
  const availability =
    serviceBuckets.length === 0
      ? null
      : Math.round(
          serviceBuckets.reduce((sum, row) => sum + row.availability_permille, 0) /
            serviceBuckets.length,
        );
  const latencies = latestChecks.flatMap((check) =>
    check.latency_ms === null ? [] : [check.latency_ms],
  );
  return {
    id: service.id,
    name: service.name,
    slug: service.slug ?? service.id,
    description: service.description,
    state: latestService ? normalizeState(latestService.state) : fallbackState,
    checkCount: checks.length,
    lastCheckedAt: latestChecks.reduce<number | null>(
      (latest, check) => Math.max(latest ?? 0, check.observed_at),
      null,
    ),
    lastTransitionAt: latestService?.last_transition_at ?? null,
    latencyMs: latencies.length === 0 ? null : Math.max(...latencies),
    availability24hPermille: availability,
    timeline: timelineForService(service.telemetry_pk, telemetry.buckets, now),
    canManage,
  };
}

export async function loadServiceCollection(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  now = Date.now(),
): Promise<ServiceCollection> {
  const access = await loadWorkspaceAccess(controlDb, workspaceSlug, userId);
  const allServices = await loadServiceRows(controlDb, access.workspace.id);
  const services = allServices.filter((service) =>
    canAccessResource(access.workspace.role, access.grants, "service", service.id, "view"),
  );
  const allowedIds = new Set(services.map((service) => service.id));
  const checks = (await loadCheckRows(controlDb, access.workspace.id)).filter(
    (check) => allowedIds.has(check.service_id) && check.enabled === 1,
  );
  const telemetry = await loadTelemetry(
    telemetryDb,
    access.workspace.telemetry_pk,
    services.map((service) => service.telemetry_pk),
    checks.map((check) => check.telemetry_pk),
    now,
  );
  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
    },
    services: services.map((service) =>
      summarizeService(
        service,
        checks.filter((check) => check.service_id === service.id),
        telemetry,
        canAccessResource(access.workspace.role, access.grants, "service", service.id, "manage"),
        now,
      ),
    ),
  };
}

export async function loadAuthorizedServiceScope(
  controlDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
): Promise<{ workspaceId: string; workspacePk: number; servicePk: number }> {
  const access = await loadWorkspaceAccess(controlDb, workspaceSlug, userId);
  const service = await loadServiceRow(controlDb, access.workspace.id, serviceId);
  if (
    !service ||
    !canAccessResource(access.workspace.role, access.grants, "service", service.id, "view")
  ) {
    throw new ServiceNotFoundError();
  }
  return {
    workspaceId: access.workspace.id,
    workspacePk: access.workspace.telemetry_pk,
    servicePk: service.telemetry_pk,
  };
}

export async function loadServiceDetail(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  now = Date.now(),
): Promise<ServiceDetail> {
  const access = await loadWorkspaceAccess(controlDb, workspaceSlug, userId);
  const service = (await loadServiceRows(controlDb, access.workspace.id)).find(
    (row) => row.id === serviceId,
  );
  if (
    !service ||
    !canAccessResource(access.workspace.role, access.grants, "service", service.id, "view")
  ) {
    throw new ServiceNotFoundError();
  }
  const canManage = canAccessResource(
    access.workspace.role,
    access.grants,
    "service",
    service.id,
    "manage",
  );
  const checks = (await loadCheckRows(controlDb, access.workspace.id)).filter(
    (check) => check.service_id === service.id,
  );
  const assertions =
    canManage && checks.length > 0
      ? (
          await controlDb
            .prepare(
              `SELECT check_id, source, operator, selector, expected_json, severity
               FROM check_assertions
               WHERE check_id IN (${placeholders(checks.length)})
               ORDER BY check_id, sort_order LIMIT 400`,
            )
            .bind(...checks.map((check) => check.id))
            .all<CheckAssertionRow>()
        ).results
      : [];
  const telemetry = await loadTelemetry(
    telemetryDb,
    access.workspace.telemetry_pk,
    [service.telemetry_pk],
    checks.map((check) => check.telemetry_pk),
    now,
  );
  const latestByCheck = new Map(telemetry.checks.map((check) => [check.check_pk, check]));
  const events = await telemetryDb
    .prepare(
      `SELECT occurred_at, previous_state, current_state, reason_code FROM state_events
     WHERE workspace_pk = ? AND resource_type = 2 AND resource_pk = ?
     ORDER BY occurred_at DESC LIMIT 50`,
    )
    .bind(access.workspace.telemetry_pk, service.telemetry_pk)
    .all<EventRow>();
  const policy = await controlDb
    .prepare(
      `SELECT effect FROM resource_public_policies
     WHERE workspace_id = ? AND resource_type = 'service' AND resource_id = ?`,
    )
    .bind(access.workspace.id, service.id)
    .first<{ effect: "allow" | "deny" }>();
  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
    },
    service: {
      ...summarizeService(
        service,
        checks.filter((check) => check.enabled === 1),
        telemetry,
        canManage,
        now,
      ),
      maintenanceUntil: service.maintenance_until,
      createdAt: service.created_at,
    },
    checks: checks.map((check) => {
      const latest = latestByCheck.get(check.telemetry_pk);
      const target = sanitizedTarget(check);
      const state = latest ? normalizeState(latest.state) : "unknown";
      return {
        id: check.id,
        name: check.name,
        kind: check.kind,
        executorKind: check.executor_kind,
        enabled: check.enabled === 1,
        intervalSeconds: check.interval_seconds,
        timeoutMs: check.timeout_ms,
        retryCount: check.retry_count,
        critical: check.critical === 1,
        failureConfirmations: check.failure_confirmations,
        recoveryConfirmations: check.recovery_confirmations,
        target: target.target,
        assertionCount: target.assertionCount,
        state: state === "maintenance" ? "unknown" : state,
        observedAt: latest?.observed_at ?? null,
        latencyMs: latest?.latency_ms ?? null,
        failureCode: latest?.failure_code ?? null,
        failureSummary: latest?.failure_summary ?? null,
        consecutiveFailures: latest?.consecutive_failures ?? 0,
        consecutiveSuccesses: latest?.consecutive_successes ?? 0,
        editConfiguration: canManage ? editConfiguration(check, assertions) : null,
      };
    }),
    events: events.results.map((event) => ({
      occurredAt: event.occurred_at,
      previousState: normalizeState(event.previous_state),
      currentState: normalizeState(event.current_state),
      reasonCode: event.reason_code,
    })),
    publicAccess: policy?.effect === "allow",
  };
}
