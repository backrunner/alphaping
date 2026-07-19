import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkspaceAuditPage } from "./workspace-audit.js";

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "workspace-audit-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL, telemetry_pk INTEGER NOT NULL,
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
      `CREATE TABLE user (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_user_id TEXT,
        action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
        before_digest TEXT, after_digest TEXT, created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 'operations', 1, 'dashboard-1', 60, NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES ('workspace-1', 'admin-1', 'admin', 'active')`,
    ),
    database.prepare(`INSERT INTO user VALUES ('admin-1', 'Admin', 'admin@example.com')`),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("workspace audit pagination bounds", () => {
  it("caps the count scan and marks totals above the visible page range", async () => {
    await database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 6000
         )
         INSERT INTO audit_logs
           (id, workspace_id, actor_user_id, action, resource_type, resource_id,
            before_digest, after_digest, created_at)
         SELECT printf('audit-%04d', value), 'workspace-1', 'admin-1',
                'resource.update', 'machine', printf('machine-%04d', value), NULL, NULL, value
         FROM sequence`,
      )
      .run();

    const page = await loadWorkspaceAuditPage(database, "operations", "admin-1", 100);

    expect(page.page).toBe(100);
    expect(page.pages).toBe(100);
    expect(page.total).toBe(5_000);
    expect(page.totalCapped).toBe(true);
    expect(page.entries).toHaveLength(50);
    expect(page.entries[0]?.id).toBe("audit-1050");
  });

  it("keeps exact totals for small workspaces", async () => {
    await database
      .prepare(
        `INSERT INTO audit_logs VALUES
          ('audit-1', 'workspace-1', 'admin-1', 'workspace.update', 'workspace',
           'workspace-1', NULL, NULL, 1)`,
      )
      .run();

    await expect(
      loadWorkspaceAuditPage(database, "operations", "admin-1", 1),
    ).resolves.toMatchObject({
      pages: 1,
      total: 1,
      totalCapped: false,
      entries: [{ id: "audit-1" }],
    });
  });
});
