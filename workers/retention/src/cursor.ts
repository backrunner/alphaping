const WORKSPACE_LEASE_MS = 15 * 60_000;

export interface WorkspaceRetentionLease {
  workspacePk: number;
  leaseUntil: number;
  eventTimeCursor: number;
}

export async function acquireWorkspaceRetentionLease(
  db: D1Database,
  workspacePk: number,
  now: number,
): Promise<WorkspaceRetentionLease | null> {
  const leaseUntil = now + WORKSPACE_LEASE_MS;
  const row = await db
    .prepare(
      `INSERT INTO retention_cursors
         (workspace_pk, table_kind, resource_pk, time_cursor, lease_until, updated_at)
       VALUES (?, 'event', 0, 0, ?, ?)
       ON CONFLICT(workspace_pk, table_kind) DO UPDATE SET
         lease_until = excluded.lease_until,
         updated_at = excluded.updated_at
       WHERE retention_cursors.lease_until <= ?
       RETURNING time_cursor`,
    )
    .bind(workspacePk, leaseUntil, now, now)
    .first<{ time_cursor: number }>();
  if (!row) return null;
  return { workspacePk, leaseUntil, eventTimeCursor: row.time_cursor };
}

export async function releaseWorkspaceRetentionLease(
  db: D1Database,
  lease: WorkspaceRetentionLease,
  eventTimeCursor: number,
  now: number,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE retention_cursors SET time_cursor = ?, lease_until = 0, updated_at = ?
       WHERE workspace_pk = ? AND table_kind = 'event' AND lease_until = ?`,
    )
    .bind(eventTimeCursor, now, lease.workspacePk, lease.leaseUntil)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("retention_lease_lost");
  }
}
