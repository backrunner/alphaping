import { queryEachInBatches } from "./d1-query-batches.js";

export interface IncidentUpdateRecord {
  id: string;
  incident_id: string;
  state: string;
  body: string;
  published_at: number | null;
  created_at: number;
}

export async function loadLatestIncidentUpdates(
  database: D1Database,
  incidentIds: readonly string[],
  perIncidentLimit: number,
  globalLimit: number,
): Promise<IncidentUpdateRecord[]> {
  if (
    !Number.isSafeInteger(perIncidentLimit) ||
    perIncidentLimit < 1 ||
    !Number.isSafeInteger(globalLimit) ||
    globalLimit < 1
  ) {
    throw new RangeError("incident update limits must be positive safe integers");
  }
  const candidates = await queryEachInBatches<IncidentUpdateRecord, string>(
    database,
    incidentIds,
    (incidentId) =>
      database
        .prepare(
          `SELECT id, incident_id, state, body, published_at, created_at
           FROM incident_updates WHERE incident_id = ?
           ORDER BY COALESCE(published_at, created_at) DESC, id LIMIT ?`,
        )
        .bind(incidentId, perIncidentLimit),
  );
  return candidates
    .sort((left, right) => {
      const time =
        (right.published_at ?? right.created_at) - (left.published_at ?? left.created_at);
      if (time !== 0) return time;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .slice(0, globalLimit);
}
