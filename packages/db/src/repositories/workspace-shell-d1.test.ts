import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkspaceShell } from "./workspace-shell.js";

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "workspace-shell-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, deleted_at INTEGER
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
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 'Operations', 'operations', NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES
        ('workspace-1', 'admin-1', 'admin', 'active'),
        ('workspace-1', 'member-1', 'member', 'active')`,
    ),
    database.prepare(`INSERT INTO machines VALUES ('machine-1', 'workspace-1', NULL)`),
    database.prepare(`INSERT INTO services VALUES ('service-1', 'workspace-1', NULL)`),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("workspace shell navigation query", () => {
  it("shows all configured modules to administrators", async () => {
    await expect(loadWorkspaceShell(database, "operations", "admin-1")).resolves.toMatchObject({
      navigation: { machines: true, services: true, developer: true },
    });
  });

  it("applies member grants and deny-wins semantics", async () => {
    await database.batch([
      database.prepare(
        `INSERT INTO resource_grants VALUES
          ('workspace-1', 'member-1', 'machine', 'machine-1', 'manage', 'allow'),
          ('workspace-1', 'member-1', 'service', 'service-1', 'view', 'allow'),
          ('workspace-1', 'member-1', 'service', 'service-1', 'view', 'deny')`,
      ),
    ]);

    await expect(loadWorkspaceShell(database, "operations", "member-1")).resolves.toMatchObject({
      navigation: { machines: true, services: false, developer: false },
    });
  });

  it("keeps the navigation result bounded with thousands of invisible resources", async () => {
    await database.batch([
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (2) UNION ALL SELECT value + 1 FROM sequence WHERE value < 2000
         )
         INSERT INTO machines (id, workspace_id, deleted_at)
         SELECT printf('machine-%04d', value), 'workspace-1', NULL FROM sequence`,
      ),
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (2) UNION ALL SELECT value + 1 FROM sequence WHERE value < 2000
         )
         INSERT INTO services (id, workspace_id, deleted_at)
         SELECT printf('service-%04d', value), 'workspace-1', NULL FROM sequence`,
      ),
    ]);

    await expect(loadWorkspaceShell(database, "operations", "member-1")).resolves.toMatchObject({
      navigation: { machines: false, services: false, developer: false },
    });
  });
});
