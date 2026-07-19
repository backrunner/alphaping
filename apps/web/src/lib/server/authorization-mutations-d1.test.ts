import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { queueAgentCommand } from "./agent-commands.js";
import { appendIncidentUpdate, createAnnouncement, createIncident } from "./incident-management.js";

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
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE agents (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, machine_id TEXT NOT NULL, status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE agent_commands (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL, type TEXT NOT NULL,
        payload_json TEXT NOT NULL, state TEXT NOT NULL, not_before INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, attempt_limit INTEGER NOT NULL,
        payload_schema_version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE incidents (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        severity TEXT NOT NULL, state TEXT NOT NULL, starts_at INTEGER NOT NULL, resolved_at INTEGER,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE incident_resources (
        incident_id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
        impact TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE incident_updates (
        id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL,
        published_at INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE announcements (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
        severity TEXT NOT NULL, visibility TEXT NOT NULL, starts_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 1, 'operations', 'dashboard-1', 60, NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES ('workspace-1', 'user-1', 'member', 'active')`,
    ),
    database.prepare(`INSERT INTO machines VALUES ('machine-1', 'workspace-1', NULL)`),
    database.prepare(`INSERT INTO agents VALUES ('agent-1', 'workspace-1', 'machine-1', 'active')`),
    database.prepare(`INSERT INTO services VALUES ('service-1', 'workspace-1', NULL)`),
    database.prepare(
      `INSERT INTO resource_grants VALUES
        ('workspace-1', 'user-1', 'machine', 'machine-1', 'manage', 'allow'),
        ('workspace-1', 'user-1', 'service', 'service-1', 'manage', 'allow')`,
    ),
    database.prepare(
      `INSERT INTO incidents VALUES
        ('incident-1', 'workspace-1', 'Outage', 'Investigating', 'major', 'investigating',
         1, NULL, 'user-1', 1, 1, NULL)`,
    ),
    database.prepare(
      `INSERT INTO incident_resources VALUES ('incident-1', 'service', 'service-1', 'down')`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

function mutateBeforeRun(db: D1Database, mutation: string): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (query: string) => {
        const statement = target.prepare(query);
        if (
          !query.includes("INSERT INTO agent_commands") &&
          !query.includes("INSERT INTO announcements")
        ) {
          return statement;
        }
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
                  if (boundProperty !== "run") {
                    const value = Reflect.get(boundTarget, boundProperty);
                    return typeof value === "function" ? value.bind(boundTarget) : value;
                  }
                  return async () => {
                    await target.prepare(mutation).run();
                    return boundTarget.run();
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

describe("final mutation authorization", () => {
  it("rejects an Agent command after the machine grant is revoked", async () => {
    await expect(
      queueAgentCommand(
        mutateBeforeRun(database, "DELETE FROM resource_grants WHERE resource_type = 'machine'"),
        "operations",
        "user-1",
        "machine-1",
        { type: "redetect_runtimes" },
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM agent_commands").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("rejects incident creation after service access is revoked", async () => {
    await expect(
      createIncident(
        mutateBeforeBatch(database, "DELETE FROM resource_grants WHERE resource_type = 'service'"),
        "operations",
        "user-1",
        {
          title: "New outage",
          summary: "The API is unavailable.",
          severity: "major",
          serviceIds: ["service-1"],
          impact: "down",
          startsAt: Date.now(),
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM incidents").first(),
    ).resolves.toEqual({ count: 1 });
  });

  it("rejects incident updates after inherited service access is revoked", async () => {
    await expect(
      appendIncidentUpdate(
        mutateBeforeBatch(database, "DELETE FROM resource_grants WHERE resource_type = 'service'"),
        "operations",
        "user-1",
        "incident-1",
        { state: "identified", body: "The upstream is unavailable." },
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT state FROM incidents WHERE id = 'incident-1'").first(),
    ).resolves.toEqual({ state: "investigating" });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM incident_updates").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("fails explicitly when an incident has more than 20 affected services", async () => {
    const services = Array.from({ length: 20 }, (_, index) => `service-extra-${index + 1}`);
    await database.batch(
      services.flatMap((serviceId) => [
        database.prepare("INSERT INTO services VALUES (?, 'workspace-1', NULL)").bind(serviceId),
        database
          .prepare(
            `INSERT INTO resource_grants VALUES
              ('workspace-1', 'user-1', 'service', ?, 'manage', 'allow')`,
          )
          .bind(serviceId),
        database
          .prepare("INSERT INTO incident_resources VALUES ('incident-1', 'service', ?, 'down')")
          .bind(serviceId),
      ]),
    );

    await expect(
      appendIncidentUpdate(database, "operations", "user-1", "incident-1", {
        state: "identified",
        body: "The upstream is unavailable.",
      }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      database.prepare("SELECT state FROM incidents WHERE id = 'incident-1'").first(),
    ).resolves.toEqual({ state: "investigating" });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM incident_updates").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("rejects announcements after administrator access is lost", async () => {
    await database.prepare("UPDATE memberships SET role = 'admin' WHERE user_id = 'user-1'").run();
    await expect(
      createAnnouncement(
        mutateBeforeRun(
          database,
          "UPDATE memberships SET role = 'member' WHERE user_id = 'user-1'",
        ),
        "operations",
        "user-1",
        {
          title: "Maintenance",
          body: "Maintenance is underway.",
          severity: "maintenance",
          visibility: "public",
          startsAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM announcements").first(),
    ).resolves.toEqual({ count: 0 });
  });
});
