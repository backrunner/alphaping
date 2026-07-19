import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadMonitoringAccess } from "./monitoring-access.js";

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "monitoring-access-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, slug TEXT NOT NULL,
        default_dashboard_id TEXT NOT NULL, default_sampling_interval_seconds INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE resource_grants (
        workspace_id TEXT NOT NULL, subject_user_id TEXT NOT NULL, resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL, capability TEXT NOT NULL, effect TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 1, 'operations', 'dashboard-1', 15, NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES
        ('workspace-1', 'admin-1', 'admin', 'active'),
        ('workspace-1', 'member-1', 'member', 'active')`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

async function seedGrants(subjectUserId: string, count: number): Promise<void> {
  await database
    .prepare(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < ?
       )
       INSERT INTO resource_grants
         SELECT 'workspace-1', ?, 'machine', printf('machine-%05d', value),
                'view', 'allow' FROM sequence`,
    )
    .bind(count, subjectUserId)
    .run();
}

describe("monitoring access grant bounds", () => {
  it("does not read stale grants for administrators", async () => {
    await seedGrants("admin-1", 5_001);

    await expect(loadMonitoringAccess(database, "operations", "admin-1")).resolves.toMatchObject({
      role: "admin",
      grants: [],
    });
  });

  it("fails explicitly when a member grant snapshot exceeds the supported limit", async () => {
    await seedGrants("member-1", 5_001);

    await expect(loadMonitoringAccess(database, "operations", "member-1")).rejects.toMatchObject({
      status: 503,
    });
  });
});
