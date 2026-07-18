const DAY_MS = 86_400_000;
const COMMAND_AUDIT_DAYS = 30;
const ORPHAN_SECRET_GRACE_MS = DAY_MS;
const ORPHAN_SECRET_BATCH = 50;

export interface CommandCleanupResult {
  deleted: number;
  expired: number;
}

async function deleteCommands(
  db: D1Database,
  predicate: string,
  cutoff: number,
  rowBatch: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM agent_commands WHERE id IN (
         SELECT id FROM agent_commands WHERE ${predicate}
         ORDER BY COALESCE(completed_at, expires_at), id LIMIT ?
       )`,
    )
    .bind(cutoff, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}

export async function cleanAgentCommands(
  db: D1Database,
  now: number,
  rowBatch = 200,
): Promise<CommandCleanupResult> {
  const auditCutoff = now - COMMAND_AUDIT_DAYS * DAY_MS;
  const abandoned = await deleteCommands(
    db,
    "state IN ('pending', 'delivered') AND expires_at < ?",
    auditCutoff,
    rowBatch,
  );
  const terminal = await deleteCommands(
    db,
    "state IN ('succeeded', 'failed', 'expired') AND completed_at < ?",
    auditCutoff,
    rowBatch,
  );
  const expired = await db
    .prepare(
      `UPDATE agent_commands
       SET state = 'expired', completed_at = COALESCE(completed_at, expires_at),
           result_code = COALESCE(result_code, 'command_expired')
       WHERE id IN (
         SELECT id FROM agent_commands
         WHERE state IN ('pending', 'delivered') AND expires_at <= ?
         ORDER BY expires_at, id LIMIT ?
       )`,
    )
    .bind(now, rowBatch)
    .run();
  return {
    deleted: abandoned + terminal,
    expired: expired.meta.changes ?? 0,
  };
}

export async function cleanExpiredAnnouncements(
  db: D1Database,
  workspaceId: string,
  now: number,
  graceDays = 7,
  rowBatch = 200,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM announcements WHERE id IN (
         SELECT id FROM announcements WHERE workspace_id = ? AND expires_at < ?
         ORDER BY expires_at, id LIMIT ?
       )`,
    )
    .bind(workspaceId, now - graceDays * DAY_MS, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}

export async function cleanAuditLogs(
  db: D1Database,
  workspaceId: string,
  now: number,
  retentionDays: number,
  rowBatch = 200,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM audit_logs WHERE id IN (
         SELECT id FROM audit_logs WHERE workspace_id = ? AND created_at < ?
         ORDER BY created_at, id LIMIT ?
       )`,
    )
    .bind(workspaceId, now - retentionDays * DAY_MS, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}

export async function cleanOrphanCheckSecrets(
  db: D1Database,
  workspaceId: string,
  now: number,
  rowBatch = ORPHAN_SECRET_BATCH,
): Promise<number> {
  if (!Number.isInteger(rowBatch) || rowBatch < 1 || rowBatch > ORPHAN_SECRET_BATCH) {
    throw new Error("orphan check secret batch must be between 1 and 50");
  }
  const result = await db
    .prepare(
      `DELETE FROM check_secrets WHERE id IN (
         SELECT secret.id FROM check_secrets secret
         WHERE secret.workspace_id = ? AND secret.created_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM check_configs config,
               json_tree(
                 CASE WHEN json_valid(config.secret_refs_json)
                   THEN config.secret_refs_json ELSE '{}' END
               ) secret_ref
             WHERE config.workspace_id = secret.workspace_id
               AND secret_ref.type = 'text' AND secret_ref.atom = secret.id
           )
         ORDER BY secret.id LIMIT ?
       )`,
    )
    .bind(workspaceId, now - ORPHAN_SECRET_GRACE_MS, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}
