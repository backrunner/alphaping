import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { updateWorkspaceMembership } from "./workspace-access.js";

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
      `CREATE TABLE resource_grants (
        workspace_id TEXT NOT NULL,
        subject_user_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        effect TEXT NOT NULL
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
        ('workspace-1', 'admin-b', 'admin', 'active', 1, 1)`,
    ),
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
