import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLatestIncidentUpdates } from "./incident-updates.js";

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "incident-update-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE incident_updates (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        state TEXT NOT NULL,
        body TEXT NOT NULL,
        published_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE INDEX incident_updates_projection_timeline_idx
       ON incident_updates (incident_id, COALESCE(published_at, created_at) DESC, id)`,
    ),
  ]);
  for (let incident = 1; incident <= 3; incident += 1) {
    await database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 75
         )
         INSERT INTO incident_updates
           (id, incident_id, state, body, published_at, created_at)
         SELECT printf('update-%d-%03d', ?, value), printf('incident-%d', ?),
                'monitoring', printf('Update %03d', value),
                CASE WHEN ? = 3 THEN NULL ELSE ? + value END,
                ? + value FROM sequence`,
      )
      .bind(incident, incident, incident, incident * 1_000, incident * 1_000)
      .run();
  }
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("incident update timeline bounds", () => {
  it("uses the timeline index and globally merges bounded per-incident candidates", async () => {
    const plan = await database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, incident_id, state, body, published_at, created_at
         FROM incident_updates WHERE incident_id = ?
         ORDER BY COALESCE(published_at, created_at) DESC, id LIMIT ?`,
      )
      .bind("incident-1", 20)
      .all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join("\n")).toContain(
      "incident_updates_projection_timeline_idx",
    );

    const updates = await loadLatestIncidentUpdates(
      database,
      ["incident-1", "incident-2", "incident-3"],
      20,
      50,
    );
    const countByIncident = new Map<string, number>();
    for (const update of updates) {
      countByIncident.set(update.incident_id, (countByIncident.get(update.incident_id) ?? 0) + 1);
    }

    expect(updates).toHaveLength(50);
    expect(countByIncident).toEqual(
      new Map([
        ["incident-1", 10],
        ["incident-2", 20],
        ["incident-3", 20],
      ]),
    );
    expect(updates.map((update) => update.id)).toContain("update-3-075");
    expect(updates.map((update) => update.id)).not.toContain("update-3-055");
  });
});
