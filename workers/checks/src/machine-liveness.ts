const MAX_MACHINE_CANDIDATES = 1_000;
const LATEST_QUERY_BATCH = 50;
const TRANSITION_BATCH = 25;

export interface MachineControlRow {
  telemetry_pk: number;
  offline_after_seconds: number;
  maintenance_until: number | null;
}

interface MachineLatestRow {
  machine_pk: number;
  received_at: number;
  state: string;
}

interface OfflineTransition {
  eventId: ArrayBuffer;
  machinePk: number;
  occurredAt: number;
  previousState: string;
  receivedAt: number;
}

export interface MachineLivenessResult {
  scanned: number;
  transitioned: number;
}

export async function loadMachineLivenessCandidates(
  controlDb: D1Database,
  cursor: number,
): Promise<MachineControlRow[]> {
  const machines = await controlDb
    .prepare(
      `SELECT m.telemetry_pk, m.offline_after_seconds, m.maintenance_until
       FROM machines m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.deleted_at IS NULL AND w.deleted_at IS NULL
       ORDER BY CASE WHEN m.telemetry_pk > ? THEN 0 ELSE 1 END, m.telemetry_pk
       LIMIT ?`,
    )
    .bind(cursor, MAX_MACHINE_CANDIDATES)
    .all<MachineControlRow>();
  return machines.results;
}

export function offlineTransitionAt(
  machine: MachineControlRow,
  latest: MachineLatestRow,
  now: number,
): number | null {
  if (
    latest.state === "offline" ||
    latest.state === "maintenance" ||
    (machine.maintenance_until !== null && machine.maintenance_until > now)
  ) {
    return null;
  }
  const transitionAt = latest.received_at + machine.offline_after_seconds * 1_000;
  return transitionAt <= now ? transitionAt : null;
}

async function offlineEventId(machinePk: number, occurredAt: number): Promise<ArrayBuffer> {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`alphaping:machine-offline:v1:${machinePk}:${occurredAt}`),
  );
}

async function loadLatestRows(
  db: D1Database,
  machines: readonly MachineControlRow[],
): Promise<Map<number, MachineLatestRow>> {
  const latestByMachine = new Map<number, MachineLatestRow>();
  for (let offset = 0; offset < machines.length; offset += LATEST_QUERY_BATCH) {
    const batch = machines.slice(offset, offset + LATEST_QUERY_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const latest = await db
      .prepare(
        `SELECT machine_pk, received_at, state FROM machine_latest
         WHERE machine_pk IN (${placeholders})`,
      )
      .bind(...batch.map((machine) => machine.telemetry_pk))
      .all<MachineLatestRow>();
    for (const row of latest.results) latestByMachine.set(row.machine_pk, row);
  }
  return latestByMachine;
}

async function persistOfflineTransitions(
  db: D1Database,
  transitions: readonly OfflineTransition[],
): Promise<number> {
  let transitioned = 0;
  for (let offset = 0; offset < transitions.length; offset += TRANSITION_BATCH) {
    const batch = transitions.slice(offset, offset + TRANSITION_BATCH);
    const statements = batch.flatMap((transition) => [
      db
        .prepare(
          `INSERT OR IGNORE INTO state_events
            (workspace_pk, resource_type, resource_pk, occurred_at, event_id,
             previous_state, current_state, reason_code)
           SELECT workspace_pk, 1, machine_pk, ?, ?, state, 'offline', 'report_timeout'
           FROM machine_latest
           WHERE machine_pk = ? AND received_at = ? AND state = ?`,
        )
        .bind(
          transition.occurredAt,
          transition.eventId,
          transition.machinePk,
          transition.receivedAt,
          transition.previousState,
        ),
      db
        .prepare(
          `UPDATE machine_latest SET state = 'offline'
           WHERE machine_pk = ? AND received_at = ? AND state = ?`,
        )
        .bind(transition.machinePk, transition.receivedAt, transition.previousState),
    ]);
    const results = await db.batch(statements);
    for (let index = 1; index < results.length; index += 2) {
      transitioned += results[index]?.meta.changes ?? 0;
    }
  }
  return transitioned;
}

export async function reconcileMachineLiveness(
  telemetryDb: D1Database,
  now: number,
  machines: readonly MachineControlRow[],
): Promise<MachineLivenessResult> {
  const latestByMachine = await loadLatestRows(telemetryDb, machines);
  const transitions: OfflineTransition[] = [];
  for (const machine of machines) {
    const latest = latestByMachine.get(machine.telemetry_pk);
    if (!latest) continue;
    const occurredAt = offlineTransitionAt(machine, latest, now);
    if (occurredAt === null) continue;
    transitions.push({
      eventId: await offlineEventId(machine.telemetry_pk, occurredAt),
      machinePk: machine.telemetry_pk,
      occurredAt,
      previousState: latest.state,
      receivedAt: latest.received_at,
    });
  }
  return {
    scanned: machines.length,
    transitioned: await persistOfflineTransitions(telemetryDb, transitions),
  };
}
