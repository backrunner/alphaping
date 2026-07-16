const DAY_MS = 86_400_000;
const COMMAND_AUDIT_DAYS = 30;

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
  rowBatch = 200,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM announcements WHERE id IN (
         SELECT id FROM announcements WHERE workspace_id = ? AND expires_at < ?
         ORDER BY expires_at, id LIMIT ?
       )`,
    )
    .bind(workspaceId, now - 7 * DAY_MS, rowBatch)
    .run();
  return result.meta.changes ?? 0;
}
