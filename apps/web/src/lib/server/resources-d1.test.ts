import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitoring-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./monitoring-access.js")>();
  return { ...actual, loadMonitoringAccess: vi.fn() };
});

import { createMachine, softDeleteResource, updateMachineConfiguration } from "./resources.js";
import { loadMonitoringAccess } from "./monitoring-access.js";

const configuration = {
  name: "edge-01",
  expectedHost: "192.0.2.10",
  description: "Singapore gateway",
  labels: "region=ap-southeast-1",
  samplingIntervalSeconds: 15,
  reportIntervalSeconds: 120,
  offlineAfterSeconds: 300,
  containersEnabled: true,
  maintenanceUntil: null,
};

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  vi.mocked(loadMonitoringAccess).mockResolvedValue({
    workspaceId: "workspace-1",
    workspacePk: 1,
    defaultDashboardId: "dashboard-1",
    defaultSamplingIntervalSeconds: 60,
    role: "admin",
    grants: [],
  });
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "control-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE telemetry_resource_sequences (
        kind TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE agent_enrollment_tokens (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        token_digest BLOB,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        revoked_at INTEGER,
        created_by TEXT,
        created_at INTEGER NOT NULL
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
      `CREATE TABLE dashboard_resources (
        dashboard_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        public_override TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE resource_public_policies (
        workspace_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        effect TEXT NOT NULL,
        projection_profile TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        public_slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        expected_host TEXT,
        labels_json TEXT NOT NULL,
        sampling_interval_seconds INTEGER NOT NULL,
        report_interval_seconds INTEGER NOT NULL,
        offline_after_seconds INTEGER NOT NULL,
        container_monitoring_enabled INTEGER NOT NULL,
        maintenance_until INTEGER,
        desired_config_revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(`INSERT INTO telemetry_resource_sequences VALUES ('machine', 1)`),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        executor_kind TEXT NOT NULL,
        executor_agent_id TEXT,
        enabled INTEGER NOT NULL
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
      `INSERT INTO machines VALUES
          ('machine-1', 1, 'workspace-1', 'public-edge-01', 'edge-01', 'Initial', NULL, '{}',
           15, 120, 300, 1, NULL, 1, 1, 1, NULL)`,
    ),
    database.prepare(`INSERT INTO memberships VALUES ('workspace-1', 'user-1', 'admin', 'active')`),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

function synchronizeConfigurationReads(db: D1Database, expectedReads: number): D1Database {
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
        if (!query.includes("FROM machines WHERE id = ?") || !query.includes("labels_json")) {
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

describe("machine configuration revision", () => {
  it("rejects machine creation after the actor loses administrator access", async () => {
    const stale = new Proxy(database, {
      get(target, property) {
        if (property !== "batch") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async <T>(statements: D1PreparedStatement[]) => {
          await target
            .prepare(
              `UPDATE memberships SET role = 'member'
               WHERE workspace_id = 'workspace-1' AND user_id = 'user-1'`,
            )
            .run();
          return target.batch<T>(statements);
        };
      },
    });

    await expect(
      createMachine(stale, "operations", "user-1", "0".repeat(64), {
        ...configuration,
        name: "edge-02",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM machines").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });

  it("lets only one concurrent update commit from the same revision", async () => {
    const synchronized = synchronizeConfigurationReads(database, 2);
    const outcomes = await Promise.allSettled([
      updateMachineConfiguration(synchronized, "operations", "user-1", "machine-1", {
        ...configuration,
        name: "edge-a",
      }),
      updateMachineConfiguration(synchronized, "operations", "user-1", "machine-1", {
        ...configuration,
        name: "edge-b",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "fulfilled")).toMatchObject({
      value: { revision: 2 },
    });
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      database
        .prepare("SELECT desired_config_revision AS revision FROM machines WHERE id = ?")
        .bind("machine-1")
        .first<{ revision: number }>(),
    ).resolves.toEqual({ revision: 2 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
  });

  it("rejects an update after the actor loses its manage grant", async () => {
    vi.mocked(loadMonitoringAccess).mockResolvedValue({
      workspaceId: "workspace-1",
      workspacePk: 1,
      defaultDashboardId: "dashboard-1",
      defaultSamplingIntervalSeconds: 60,
      role: "member",
      grants: [
        {
          resourceType: "machine",
          resourceId: "machine-1",
          capability: "manage",
          effect: "allow",
        },
      ],
    });
    await database.batch([
      database.prepare(
        `UPDATE memberships SET role = 'member' WHERE workspace_id = 'workspace-1' AND user_id = 'user-1'`,
      ),
      database.prepare(
        `INSERT INTO resource_grants VALUES
          ('workspace-1', 'user-1', 'machine', 'machine-1', 'manage', 'allow')`,
      ),
    ]);
    const stale = new Proxy(database, {
      get(target, property) {
        if (property !== "batch") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async <T>(statements: D1PreparedStatement[]) => {
          await target
            .prepare(
              `DELETE FROM resource_grants WHERE subject_user_id = 'user-1' AND resource_id = 'machine-1'`,
            )
            .run();
          return target.batch<T>(statements);
        };
      },
    });

    await expect(
      updateMachineConfiguration(stale, "operations", "user-1", "machine-1", configuration),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database
        .prepare("SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'")
        .first<{ revision: number }>(),
    ).resolves.toEqual({ revision: 1 });
  });
});

describe("service deletion assignment revision", () => {
  it("includes Agent assignments created immediately before the delete batch", async () => {
    await database.batch([
      database.prepare("INSERT INTO services VALUES ('service-1', 'workspace-1', 'API', 1, NULL)"),
      database.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 'active')"),
    ]);
    let insertedAssignment = false;
    const synchronized = new Proxy(database, {
      get(target, property) {
        if (property !== "batch") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async <T>(statements: D1PreparedStatement[]) => {
          if (!insertedAssignment) {
            insertedAssignment = true;
            await target
              .prepare(
                `INSERT INTO check_configs VALUES
                  ('check-1', 'workspace-1', 'service-1', 'agent', 'agent-1', 1)`,
              )
              .run();
          }
          return target.batch<T>(statements);
        };
      },
    });

    await expect(
      softDeleteResource(synchronized, "operations", "user-1", "service", "service-1"),
    ).resolves.toBeUndefined();
    await expect(
      database
        .prepare("SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'")
        .first<{ revision: number }>(),
    ).resolves.toEqual({ revision: 2 });
  });

  it("does not advance Agent assignments when the service delete is stale", async () => {
    await database.batch([
      database.prepare("INSERT INTO services VALUES ('service-1', 'workspace-1', 'API', 1, NULL)"),
      database.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 'active')"),
      database.prepare(
        `INSERT INTO check_configs VALUES
          ('check-1', 'workspace-1', 'service-1', 'agent', 'agent-1', 1)`,
      ),
    ]);
    const stale = new Proxy(database, {
      get(target, property) {
        if (property !== "batch") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async <T>(statements: D1PreparedStatement[]) => {
          await target.prepare("UPDATE services SET deleted_at = 10 WHERE id = 'service-1'").run();
          return target.batch<T>(statements);
        };
      },
    });

    await expect(
      softDeleteResource(stale, "operations", "user-1", "service", "service-1"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database
        .prepare("SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'")
        .first<{ revision: number }>(),
    ).resolves.toEqual({ revision: 1 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });
});
