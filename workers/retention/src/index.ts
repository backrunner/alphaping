import { cleanArtifactBucket } from "./artifact-retention";
import { cleanAgentCommands, cleanAuditLogs, cleanExpiredAnnouncements } from "./control-retention";
import { acquireWorkspaceRetentionLease, releaseWorkspaceRetentionLease } from "./cursor";
import { finalizeDeletedWorkspace, finalizeSoftDeletedResources } from "./soft-delete";
import {
  cleanStateEvents,
  cleanTelemetryHistory,
  type RetentionPolicyRow,
} from "./telemetry-retention";

const POLICY_BATCH = 100;

export interface RetentionPolicyBatch {
  policies: readonly RetentionPolicyRow[];
  workspaceCursor: number;
  nextWorkspaceCursor: number;
}

interface WorkspaceCleanupResult {
  deletedRows: number;
  processed: boolean;
}

export function resolveRetentionWorkspaceCursor(
  policyBatch: RetentionPolicyBatch,
  skippedWorkspaces: number,
): number {
  return skippedWorkspaces === 0 ? policyBatch.nextWorkspaceCursor : policyBatch.workspaceCursor;
}

export async function loadRetentionPolicyBatch(
  controlDb: D1Database,
  telemetryDb: D1Database,
  runId: string,
  policyBatch = POLICY_BATCH,
): Promise<RetentionPolicyBatch> {
  if (!Number.isInteger(policyBatch) || policyBatch < 1 || policyBatch > POLICY_BATCH) {
    throw new Error("retention policy batch must be between 1 and 100");
  }
  const previous = await telemetryDb
    .prepare(
      `SELECT workspace_cursor FROM retention_runs
       WHERE run_id < ? AND completed_at IS NOT NULL AND error_code IS NULL
       ORDER BY run_id DESC LIMIT 1`,
    )
    .bind(runId)
    .first<{ workspace_cursor: number }>();
  const workspaceCursor = previous?.workspace_cursor ?? 0;
  const rows = await controlDb
    .prepare(
      `SELECT w.id AS workspace_id, w.telemetry_pk AS workspace_pk,
              w.deleted_at AS workspace_deleted_at,
              w.purge_started_at AS workspace_purge_started_at,
              p.raw_days, p.rollup_5m_days, p.rollup_1h_days, p.event_days,
              p.audit_log_days, p.expired_announcement_grace_days,
              p.soft_delete_grace_days
       FROM retention_policies p JOIN workspaces w ON w.id = p.workspace_id
       WHERE w.telemetry_pk > ?
       ORDER BY w.telemetry_pk LIMIT ?`,
    )
    .bind(workspaceCursor, policyBatch + 1)
    .all<RetentionPolicyRow>();
  const policies = rows.results.slice(0, policyBatch);
  return {
    policies,
    workspaceCursor,
    nextWorkspaceCursor:
      rows.results.length > policyBatch ? (policies.at(-1)?.workspace_pk ?? 0) : 0,
  };
}

async function cleanWorkspace(
  env: Env,
  policy: RetentionPolicyRow,
  now: number,
): Promise<WorkspaceCleanupResult> {
  const lease = await acquireWorkspaceRetentionLease(
    env.TELEMETRY_DB,
    policy.workspace_pk,
    Date.now(),
  );
  if (!lease) return { deletedRows: 0, processed: false };

  const telemetry = await cleanTelemetryHistory(env, policy, now);
  const events = await cleanStateEvents(env.TELEMETRY_DB, policy, lease.eventTimeCursor, now);
  const announcements = await cleanExpiredAnnouncements(
    env.CONTROL_DB,
    policy.workspace_id,
    now,
    policy.expired_announcement_grace_days,
  );
  const auditLogs = await cleanAuditLogs(
    env.CONTROL_DB,
    policy.workspace_id,
    now,
    policy.audit_log_days,
  );
  const softDeletes = await finalizeSoftDeletedResources(env, policy, now);
  await releaseWorkspaceRetentionLease(env.TELEMETRY_DB, lease, events.timeCursor, Date.now());
  const workspace = await finalizeDeletedWorkspace(env, policy, now);
  return {
    deletedRows: telemetry + events.deleted + announcements + auditLogs + softDeletes + workspace,
    processed: true,
  };
}

export async function runRetention(env: Env, scheduledTime: number): Promise<void> {
  const runId = `retention:${scheduledTime}`;
  const claimed = await env.TELEMETRY_DB.prepare(
    "INSERT OR IGNORE INTO retention_runs (run_id, started_at, deleted_rows) VALUES (?, ?, 0)",
  )
    .bind(runId, Date.now())
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) return;

  try {
    const policyBatch = await loadRetentionPolicyBatch(env.CONTROL_DB, env.TELEMETRY_DB, runId);
    let deleted = 0;
    let skippedWorkspaces = 0;
    for (const policy of policyBatch.policies) {
      const result = await cleanWorkspace(env, policy, scheduledTime);
      deleted += result.deletedRows;
      if (!result.processed) skippedWorkspaces += 1;
    }
    const commands = await cleanAgentCommands(env.CONTROL_DB, scheduledTime);
    deleted += commands.deleted;
    const artifacts = await cleanArtifactBucket(env, scheduledTime);
    const workspaceCursor = resolveRetentionWorkspaceCursor(policyBatch, skippedWorkspaces);
    await env.TELEMETRY_DB.prepare(
      `UPDATE retention_runs
       SET completed_at = ?, deleted_rows = ?, workspace_cursor = ?
       WHERE run_id = ?`,
    )
      .bind(Date.now(), deleted, workspaceCursor, runId)
      .run();
    console.log(
      JSON.stringify({
        event: "retention_completed",
        deletedRows: deleted,
        expiredCommands: commands.expired,
        scannedArtifacts: artifacts.scanned,
        deletedArtifacts: artifacts.deleted,
        skippedArtifactPrefixes: artifacts.skippedPrefixes,
        skippedWorkspaces,
      }),
    );
  } catch (error) {
    await env.TELEMETRY_DB.prepare(
      "UPDATE retention_runs SET completed_at = ?, error_code = ? WHERE run_id = ?",
    )
      .bind(Date.now(), "retention_failed", runId)
      .run();
    throw error;
  }
}

export default {
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(runRetention(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
