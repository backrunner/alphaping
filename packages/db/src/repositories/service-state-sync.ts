const JOB_BATCH = 50;
export const SERVICE_STATE_SYNC_GUARD_MS = 15 * 60_000;

export type ServiceStateSyncReason =
  "check_configuration" | "maintenance_window" | "maintenance_window_ended";

export interface ServiceStateSyncJob {
  jobKey: string;
  syncToken: string;
  workspaceId: string;
  workspacePk: number;
  serviceId: string;
  servicePk: number;
  checkId: string | null;
  checkPk: number | null;
  reasonCode: ServiceStateSyncReason;
  protectUntil: number;
  nextAttemptAt: number;
  lastAttemptedAt: number;
  updatedAt: number;
}

interface ServiceStateSyncJobRow {
  job_key: string;
  sync_token: string;
  workspace_id: string;
  workspace_pk: number;
  service_id: string;
  service_pk: number;
  check_id: string | null;
  check_pk: number | null;
  reason_code: ServiceStateSyncReason;
  protect_until: number;
  next_attempt_at: number;
  last_attempted_at: number;
  updated_at: number;
}

interface DesiredServiceStateRow {
  workspace_pk: number;
  service_pk: number;
  maintenance_until: number | null;
  check_pk: number | null;
  enabled: number | null;
  critical: number | null;
  executor_kind: "cloudflare" | "agent" | null;
  config_revision: number | null;
}

interface CheckStateRow {
  state: string;
  critical: number;
}

interface AppliedServiceState {
  maintenanceUntil: number | null;
}

export interface ServiceStateSyncProgress {
  processed: number;
  completed: number;
  failed: number;
}

export function createServiceStateSyncJob(
  input: Omit<
    ServiceStateSyncJob,
    "jobKey" | "syncToken" | "protectUntil" | "nextAttemptAt" | "lastAttemptedAt"
  >,
  retainUntil?: number,
): ServiceStateSyncJob {
  const jobKey = input.checkId === null ? `service:${input.serviceId}` : `check:${input.checkId}`;
  const guardUntil = input.updatedAt + SERVICE_STATE_SYNC_GUARD_MS;
  return {
    ...input,
    jobKey,
    syncToken: crypto.randomUUID(),
    protectUntil: Math.max(guardUntil, retainUntil ?? guardUntil),
    nextAttemptAt: input.updatedAt,
    lastAttemptedAt: input.updatedAt,
  };
}

export function prepareServiceStateSyncJob(
  db: D1Database,
  job: ServiceStateSyncJob,
  onlyIfPreviousStatementChanged = false,
): D1PreparedStatement {
  const values = onlyIfPreviousStatementChanged
    ? "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1"
    : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return db
    .prepare(
      `INSERT INTO service_state_sync_jobs
        (job_key, sync_token, workspace_id, workspace_pk, service_id, service_pk,
         check_id, check_pk, reason_code, protect_until, next_attempt_at,
         last_attempted_at, updated_at)
       ${values}
       ON CONFLICT(job_key) DO UPDATE SET
         sync_token = excluded.sync_token,
         workspace_id = excluded.workspace_id,
         workspace_pk = excluded.workspace_pk,
         service_id = excluded.service_id,
         service_pk = excluded.service_pk,
         check_id = excluded.check_id,
         check_pk = excluded.check_pk,
         reason_code = excluded.reason_code,
         protect_until = excluded.protect_until,
         next_attempt_at = excluded.next_attempt_at,
         last_attempted_at = excluded.last_attempted_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      job.jobKey,
      job.syncToken,
      job.workspaceId,
      job.workspacePk,
      job.serviceId,
      job.servicePk,
      job.checkId,
      job.checkPk,
      job.reasonCode,
      job.protectUntil,
      job.nextAttemptAt,
      job.lastAttemptedAt,
      job.updatedAt,
    );
}

function serviceState(
  checks: readonly CheckStateRow[],
  maintenanceUntil: number | null,
  now: number,
): "healthy" | "degraded" | "down" | "maintenance" | "unknown" {
  if (maintenanceUntil !== null && maintenanceUntil > now) return "maintenance";
  if (checks.some((check) => check.critical === 1 && check.state === "down")) return "down";
  if (checks.some((check) => check.state === "down" || check.state === "degraded")) {
    return "degraded";
  }
  if (checks.some((check) => check.state === "healthy")) return "healthy";
  return "unknown";
}

async function eventId(
  job: ServiceStateSyncJob,
  previousState: string,
  currentState: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${job.jobKey}:${job.syncToken}:${previousState}:${currentState}`),
  );
}

async function desiredServiceState(
  controlDb: D1Database,
  job: ServiceStateSyncJob,
): Promise<DesiredServiceStateRow | null> {
  return controlDb
    .prepare(
      `SELECT w.telemetry_pk AS workspace_pk, s.telemetry_pk AS service_pk,
              s.maintenance_until, c.telemetry_pk AS check_pk,
              c.enabled, c.critical, c.executor_kind, c.config_revision
       FROM services s
       JOIN workspaces w ON w.id = s.workspace_id AND w.deleted_at IS NULL
       LEFT JOIN check_configs c
         ON c.id = ? AND c.service_id = s.id AND c.workspace_id = s.workspace_id
       WHERE s.id = ? AND s.workspace_id = ? AND s.deleted_at IS NULL`,
    )
    .bind(job.checkId, job.serviceId, job.workspaceId)
    .first<DesiredServiceStateRow>();
}

export async function applyServiceStateSyncJob(
  controlDb: D1Database,
  telemetryDb: D1Database,
  job: ServiceStateSyncJob,
  now = Date.now(),
): Promise<AppliedServiceState> {
  const desired = await desiredServiceState(controlDb, job);
  if (desired === null) {
    if (job.checkPk !== null) {
      await telemetryDb
        .prepare("DELETE FROM check_latest WHERE workspace_pk = ? AND check_pk = ?")
        .bind(job.workspacePk, job.checkPk)
        .run();
    }
    return { maintenanceUntil: null };
  }
  if (desired.workspace_pk !== job.workspacePk || desired.service_pk !== job.servicePk) {
    throw new Error("service_state_sync_identity_changed");
  }
  if (job.checkPk !== null) {
    const currentCheck =
      desired.check_pk === job.checkPk && desired.enabled === 1 && desired.critical !== null;
    if (!currentCheck) {
      await telemetryDb
        .prepare("DELETE FROM check_latest WHERE workspace_pk = ? AND check_pk = ?")
        .bind(job.workspacePk, job.checkPk)
        .run();
    } else if (desired.executor_kind === "cloudflare" && desired.config_revision !== null) {
      await telemetryDb.batch([
        telemetryDb
          .prepare(
            "DELETE FROM check_latest WHERE workspace_pk = ? AND check_pk = ? AND config_revision != ?",
          )
          .bind(job.workspacePk, job.checkPk, desired.config_revision),
        telemetryDb
          .prepare(
            "UPDATE check_latest SET critical = ? WHERE workspace_pk = ? AND check_pk = ? AND config_revision = ?",
          )
          .bind(desired.critical, job.workspacePk, job.checkPk, desired.config_revision),
      ]);
    } else {
      await telemetryDb
        .prepare("UPDATE check_latest SET critical = ? WHERE workspace_pk = ? AND check_pk = ?")
        .bind(desired.critical, job.workspacePk, job.checkPk)
        .run();
    }
  }

  const [checks, previous] = await Promise.all([
    telemetryDb
      .prepare("SELECT state, critical FROM check_latest WHERE workspace_pk = ? AND service_pk = ?")
      .bind(job.workspacePk, job.servicePk)
      .all<CheckStateRow>(),
    telemetryDb
      .prepare("SELECT state FROM service_latest WHERE workspace_pk = ? AND service_pk = ?")
      .bind(job.workspacePk, job.servicePk)
      .first<{ state: string }>(),
  ]);
  const nextState = serviceState(checks.results, desired.maintenance_until, now);
  if (previous?.state === nextState) {
    return { maintenanceUntil: desired.maintenance_until };
  }
  const previousState = previous?.state ?? "unknown";
  const reasonCode =
    nextState === "maintenance"
      ? "maintenance_window"
      : job.reasonCode === "maintenance_window"
        ? "maintenance_window_ended"
        : job.reasonCode;
  const id = await eventId(job, previousState, nextState);
  const results = await telemetryDb.batch([
    telemetryDb
      .prepare(
        `INSERT INTO service_latest
          (service_pk, workspace_pk, state, status_since, reason_code, last_transition_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(service_pk) DO UPDATE SET
           workspace_pk = excluded.workspace_pk,
           state = excluded.state,
           status_since = excluded.status_since,
           reason_code = excluded.reason_code,
           last_transition_at = excluded.last_transition_at,
           updated_at = excluded.updated_at
         WHERE service_latest.workspace_pk = excluded.workspace_pk`,
      )
      .bind(job.servicePk, job.workspacePk, nextState, now, reasonCode, now, now),
    telemetryDb
      .prepare(
        `INSERT OR IGNORE INTO state_events
          (workspace_pk, resource_type, resource_pk, occurred_at, event_id,
           previous_state, current_state, reason_code)
         SELECT ?, 2, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      )
      .bind(job.workspacePk, job.servicePk, now, id, previousState, nextState, reasonCode),
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw new Error("service_state_sync_telemetry_identity_changed");
  }
  return { maintenanceUntil: desired.maintenance_until };
}

function rowToJob(row: ServiceStateSyncJobRow): ServiceStateSyncJob {
  return {
    jobKey: row.job_key,
    syncToken: row.sync_token,
    workspaceId: row.workspace_id,
    workspacePk: row.workspace_pk,
    serviceId: row.service_id,
    servicePk: row.service_pk,
    checkId: row.check_id,
    checkPk: row.check_pk,
    reasonCode: row.reason_code,
    protectUntil: row.protect_until,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptedAt: row.last_attempted_at,
    updatedAt: row.updated_at,
  };
}

async function markServiceStateSyncAttempt(
  controlDb: D1Database,
  job: ServiceStateSyncJob,
  now: number,
  protectUntil: number,
  nextAttemptAt: number,
): Promise<void> {
  await controlDb
    .prepare(
      `UPDATE service_state_sync_jobs
       SET protect_until = ?, last_attempted_at = ?, next_attempt_at = ?
       WHERE job_key = ? AND sync_token = ?`,
    )
    .bind(protectUntil, now, nextAttemptAt, job.jobKey, job.syncToken)
    .run();
}

function nextAttemptAfterSuccess(
  job: ServiceStateSyncJob,
  now: number,
  protectUntil: number,
): number {
  const guardUntil = job.updatedAt + SERVICE_STATE_SYNC_GUARD_MS;
  if (job.reasonCode === "maintenance_window" && now >= guardUntil && protectUntil > now) {
    return protectUntil;
  }
  return now;
}

export async function reconcileServiceStateSyncJobs(
  controlDb: D1Database,
  telemetryDb: D1Database,
  now: number,
  batch = JOB_BATCH,
): Promise<ServiceStateSyncProgress> {
  if (!Number.isInteger(batch) || batch < 1 || batch > JOB_BATCH) {
    throw new Error("service state sync batch must be between 1 and 50");
  }
  const rows = await controlDb
    .prepare(
      `SELECT job_key, sync_token, workspace_id, workspace_pk, service_id, service_pk,
              check_id, check_pk, reason_code, protect_until, next_attempt_at,
              last_attempted_at, updated_at
       FROM service_state_sync_jobs WHERE next_attempt_at <= ?
       ORDER BY next_attempt_at, last_attempted_at, job_key LIMIT ?`,
    )
    .bind(now, batch)
    .all<ServiceStateSyncJobRow>();
  let completed = 0;
  let failed = 0;
  for (const row of rows.results) {
    const job = rowToJob(row);
    try {
      const applied = await applyServiceStateSyncJob(controlDb, telemetryDb, job, now);
      const protectUntil =
        job.reasonCode === "maintenance_window" && applied.maintenanceUntil !== null
          ? Math.max(job.protectUntil, applied.maintenanceUntil)
          : job.protectUntil;
      if (protectUntil <= now) {
        const result = await controlDb
          .prepare("DELETE FROM service_state_sync_jobs WHERE job_key = ? AND sync_token = ?")
          .bind(job.jobKey, job.syncToken)
          .run();
        completed += result.meta.changes ?? 0;
      } else {
        await markServiceStateSyncAttempt(
          controlDb,
          job,
          now,
          protectUntil,
          nextAttemptAfterSuccess(job, now, protectUntil),
        );
      }
    } catch {
      failed += 1;
      try {
        await markServiceStateSyncAttempt(controlDb, job, now, job.protectUntil, now);
      } catch {
        // The job remains eligible when queue bookkeeping is temporarily unavailable.
      }
    }
  }
  return { processed: rows.results.length, completed, failed };
}
