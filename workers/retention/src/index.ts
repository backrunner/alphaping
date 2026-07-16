import { cleanAgentCommands, cleanAuditLogs, cleanExpiredAnnouncements } from "./control-retention";
import { acquireWorkspaceRetentionLease, releaseWorkspaceRetentionLease } from "./cursor";
import { finalizeDeletedWorkspace, finalizeSoftDeletedResources } from "./soft-delete";
import {
  cleanStateEvents,
  cleanTelemetryHistory,
  type RetentionPolicyRow,
} from "./telemetry-retention";

const POLICY_BATCH = 100;

async function cleanWorkspace(env: Env, policy: RetentionPolicyRow, now: number): Promise<number> {
  const lease = await acquireWorkspaceRetentionLease(
    env.TELEMETRY_DB,
    policy.workspace_pk,
    Date.now(),
  );
  if (!lease) return 0;

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
  return telemetry + events.deleted + announcements + auditLogs + softDeletes + workspace;
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
    const policies = await env.CONTROL_DB.prepare(
      `SELECT w.id AS workspace_id, w.telemetry_pk AS workspace_pk,
              w.deleted_at AS workspace_deleted_at,
              p.raw_days, p.rollup_5m_days, p.rollup_1h_days, p.event_days,
              p.audit_log_days, p.expired_announcement_grace_days,
              p.soft_delete_grace_days
       FROM retention_policies p JOIN workspaces w ON w.id = p.workspace_id
       ORDER BY w.telemetry_pk LIMIT ?`,
    )
      .bind(POLICY_BATCH)
      .all<RetentionPolicyRow>();
    let deleted = 0;
    for (const policy of policies.results) {
      deleted += await cleanWorkspace(env, policy, scheduledTime);
    }
    const commands = await cleanAgentCommands(env.CONTROL_DB, scheduledTime);
    deleted += commands.deleted;
    await env.TELEMETRY_DB.prepare(
      "UPDATE retention_runs SET completed_at = ?, deleted_rows = ? WHERE run_id = ?",
    )
      .bind(Date.now(), deleted, runId)
      .run();
    console.log(
      JSON.stringify({
        event: "retention_completed",
        deletedRows: deleted,
        expiredCommands: commands.expired,
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
