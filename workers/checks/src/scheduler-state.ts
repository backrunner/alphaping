const SCHEDULER_LEASE_MS = 15 * 60_000;

export interface SchedulerLease {
  checkCursor: number;
  machineCursor: number;
  leaseUntil: number;
}

interface SchedulerStateRow {
  check_cursor: number;
  machine_cursor: number;
  lease_until: number;
}

export async function acquireSchedulerLease(
  db: D1Database,
  now: number,
): Promise<SchedulerLease | null> {
  const leaseUntil = now + SCHEDULER_LEASE_MS;
  const row = await db
    .prepare(
      `INSERT INTO check_scheduler_state
        (singleton, check_cursor, machine_cursor, lease_until, updated_at)
       VALUES (1, 0, 0, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         lease_until = excluded.lease_until,
         updated_at = excluded.updated_at
       WHERE check_scheduler_state.lease_until <= ?
       RETURNING check_cursor, machine_cursor, lease_until`,
    )
    .bind(leaseUntil, now, now)
    .first<SchedulerStateRow>();
  return row
    ? {
        checkCursor: row.check_cursor,
        machineCursor: row.machine_cursor,
        leaseUntil: row.lease_until,
      }
    : null;
}

export async function releaseSchedulerLease(
  db: D1Database,
  lease: SchedulerLease,
  checkCursor: number,
  machineCursor: number,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE check_scheduler_state
       SET check_cursor = ?, machine_cursor = ?, lease_until = 0, updated_at = ?
       WHERE singleton = 1 AND lease_until = ?`,
    )
    .bind(checkCursor, machineCursor, now, lease.leaseUntil)
    .run();
  return (result.meta.changes ?? 0) === 1;
}
