import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadWorkspaceAccessPanel,
  setMemberResourcePermission,
  updateWorkspaceMembership,
} from "./workspace-access.js";

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "control-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE containers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        slug TEXT NOT NULL,
        default_dashboard_id TEXT NOT NULL,
        default_sampling_interval_seconds INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      )`,
    ),
    database.prepare(
      `CREATE TABLE user (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE workspace_invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        accepted_at INTEGER,
        revoked_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE resource_grants (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        subject_user_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        effect TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        before_digest TEXT,
        after_digest TEXT,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES
        ('workspace-1', 1, 'operations', 'dashboard-1', 15, NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES
        ('workspace-1', 'admin-a', 'admin', 'active', 1, 1),
        ('workspace-1', 'admin-b', 'admin', 'active', 1, 1),
        ('workspace-1', 'member-a', 'member', 'active', 1, 1)`,
    ),
    database.prepare(
      `INSERT INTO user VALUES
        ('admin-a', 'Admin A', 'admin-a@example.com'),
        ('admin-b', 'Admin B', 'admin-b@example.com'),
        ('member-a', 'Member A', 'member-a@example.com')`,
    ),
    database.prepare(`INSERT INTO machines VALUES ('machine-1', 'workspace-1', 'Edge', NULL)`),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

function synchronizeAdministratorCounts(db: D1Database, expectedReads: number): D1Database {
  let completedReads = 0;
  let releaseReads: (() => void) | undefined;
  const allReadsCompleted = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });

  return new Proxy(db, {
    get(target, property) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (query: string) => {
        const statement = target.prepare(query);
        if (!query.includes("SELECT COUNT(*) AS count FROM memberships")) return statement;
        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            if (statementProperty !== "bind") {
              const value = Reflect.get(statementTarget, statementProperty);
              return typeof value === "function" ? value.bind(statementTarget) : value;
            }
            return (...values: unknown[]) => {
              const bound = statementTarget.bind(...values);
              return new Proxy(bound, {
                get(boundTarget, boundProperty) {
                  if (boundProperty !== "first") {
                    const value = Reflect.get(boundTarget, boundProperty);
                    return typeof value === "function" ? value.bind(boundTarget) : value;
                  }
                  return async <T>() => {
                    const row = await boundTarget.first<T>();
                    completedReads += 1;
                    if (completedReads === expectedReads) releaseReads?.();
                    await allReadsCompleted;
                    return row;
                  };
                },
              });
            };
          },
        });
      };
    },
  });
}

function mutateBeforeBatch(db: D1Database, mutation: string): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property !== "batch") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async <T>(statements: D1PreparedStatement[]) => {
        await target.prepare(mutation).run();
        return target.batch<T>(statements);
      };
    },
  });
}

describe("workspace administrator invariant", () => {
  it("prevents concurrent updates from removing every active administrator", async () => {
    const synchronized = synchronizeAdministratorCounts(database, 2);
    const outcomes = await Promise.allSettled([
      updateWorkspaceMembership(synchronized, "operations", "admin-a", {
        memberId: "admin-b",
        role: "member",
        status: "active",
      }),
      updateWorkspaceMembership(synchronized, "operations", "admin-b", {
        memberId: "admin-a",
        role: "member",
        status: "active",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM memberships
           WHERE role = 'admin' AND status = 'active'`,
        )
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
  });
});

describe("resource permission authorization", () => {
  it("rejects a grant update after the actor loses administrator access", async () => {
    const stale = mutateBeforeBatch(
      database,
      `UPDATE memberships SET role = 'member'
       WHERE workspace_id = 'workspace-1' AND user_id = 'admin-a'`,
    );

    await expect(
      setMemberResourcePermission(stale, "operations", "admin-a", {
        memberId: "member-a",
        resourceType: "machine",
        resourceId: "machine-1",
        permission: "manage",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM resource_grants").first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });
});

describe("workspace access pagination", () => {
  it("keeps later members, invitations, and resources addressable", async () => {
    await database.batch([
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 120
         )
         INSERT INTO user
           SELECT printf('member-%03d', value), printf('Member %03d', value),
                  printf('member-%03d@example.com', value)
           FROM sequence`,
      ),
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 120
         )
         INSERT INTO memberships
           SELECT 'workspace-1', printf('member-%03d', value), 'member', 'active', value, value
           FROM sequence`,
      ),
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 120
         )
         INSERT INTO workspace_invitations
           SELECT printf('invite-%03d', value), 'workspace-1',
                  printf('invite-%03d@example.com', value), 'member', 5000 + value, value,
                  NULL, NULL
           FROM sequence`,
      ),
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 220
         )
         INSERT INTO machines
           SELECT printf('machine-%03d', value), 'workspace-1', printf('Machine %03d', value), NULL
           FROM sequence`,
      ),
      database.prepare(
        `INSERT INTO resource_grants
           (id, workspace_id, subject_user_id, resource_type, resource_id, capability, effect,
            created_by, created_at)
         VALUES
           ('grant-machine-220', 'workspace-1', 'member-120', 'machine', 'machine-220',
            'manage', 'allow', 'admin-a', 1)`,
      ),
    ]);

    const panel = await loadWorkspaceAccessPanel(database, "operations", "admin-a", {
      memberId: "member-120",
      memberPage: 3,
      invitationPage: 3,
      resourcePage: 5,
      now: 1_000,
    });

    expect(panel.memberPagination).toMatchObject({ page: 3, pages: 3, total: 123 });
    expect(panel.invitationPagination).toMatchObject({ page: 3, pages: 3, total: 120 });
    expect(panel.resourcePagination).toMatchObject({ page: 5, pages: 5, total: 221 });
    expect(panel.members.some((member) => member.id === "member-120")).toBe(true);
    expect(panel.invitations).toHaveLength(20);
    expect(panel.resources).toContainEqual({
      id: "machine-220",
      type: "machine",
      name: "Machine 220",
      permission: "manage",
    });
  });
});
