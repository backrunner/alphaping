import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitoring-access.js", () => ({
  loadMonitoringAccess: vi.fn(async () => ({ workspaceId: "workspace-1" })),
  requireAdmin: vi.fn(),
  requireResourceCapability: vi.fn(),
}));

import { updateMachineConfiguration } from "./resources.js";

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
        description TEXT NOT NULL,
        expected_host TEXT,
        labels_json TEXT NOT NULL,
        sampling_interval_seconds INTEGER NOT NULL,
        report_interval_seconds INTEGER NOT NULL,
        offline_after_seconds INTEGER NOT NULL,
        container_monitoring_enabled INTEGER NOT NULL,
        maintenance_until INTEGER,
        desired_config_revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
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
          ('machine-1', 'workspace-1', 'edge-01', 'Initial', NULL, '{}',
           15, 120, 300, 1, NULL, 1, 1, NULL)`,
    ),
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
});
