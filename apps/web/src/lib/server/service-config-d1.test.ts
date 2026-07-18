import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitoring-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./monitoring-access.js")>();
  return {
    ...actual,
    loadMonitoringAccess: vi.fn(),
  };
});

vi.mock("./service-config-compiler.js", () => ({
  compileServiceConfig: vi.fn(async () => ({
    request: { kind: "http", url: "https://example.test/health" },
    assertions: [],
    secretRefs: { headers: {}, body: null, tcpPayload: null },
    secrets: [],
  })),
}));

import {
  addServiceCheck,
  createServiceMonitor,
  deleteServiceCheck,
  listServiceCheckAgents,
  replaceServiceCheckConfiguration,
  setServicePublicAccess,
  updateServiceCheckPolicy,
} from "./service-config.js";
import { loadMonitoringAccess } from "./monitoring-access.js";

const input = {
  name: "Public API",
  description: "Availability check",
  kind: "http" as const,
  executorKind: "agent" as const,
  executorAgentId: "agent-1",
  intervalSeconds: 60,
  timeoutMs: 5_000,
  retryCount: 1,
  critical: true,
  failureConfirmations: 2,
  recoveryConfirmations: 2,
  method: "GET",
  url: "https://example.test/health",
  requestHeaders: "",
  secretRequestHeaders: "",
  requestBody: "",
  requestBodyIsSecret: false,
  expectedStatuses: "200",
  maxRedirects: 3,
  tlsVerify: true,
  degradedAfterMs: null,
  downAfterMs: null,
  maxResponseBytes: 65_536,
  hostname: "",
  serverName: "",
  port: 443,
  useTls: true,
  tcpPayload: "",
  tcpPayloadIsSecret: false,
  tcpResponsePrefix: "",
  assertions: [],
};

let miniflare: Miniflare;
let database: D1Database;
let telemetryDatabase: D1Database;

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
    d1Databases: { CONTROL_DB: "control-test", TELEMETRY_DB: "telemetry-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  telemetryDatabase = await miniflare.getD1Database("TELEMETRY_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE telemetry_resource_sequences (
        kind TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        desired_config_revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT NOT NULL,
        status_rule_json TEXT NOT NULL,
        maintenance_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        executor_kind TEXT NOT NULL,
        executor_agent_id TEXT,
        assignment_revision INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        interval_seconds INTEGER NOT NULL,
        phase_seconds INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        retry_count INTEGER NOT NULL,
        critical INTEGER NOT NULL,
        request_json TEXT NOT NULL,
        secret_refs_json TEXT NOT NULL,
        failure_confirmations INTEGER NOT NULL,
        recovery_confirmations INTEGER NOT NULL,
        config_bytes INTEGER NOT NULL,
        last_claimed_slot INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_secrets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        wrapped_value BLOB NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE dashboards (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        visibility TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE dashboard_resources (
        dashboard_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        public_override TEXT NOT NULL,
        PRIMARY KEY (dashboard_id, resource_type, resource_id)
      )`,
    ),
    database.prepare(
      `CREATE TABLE resource_public_policies (
        workspace_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        effect TEXT NOT NULL,
        projection_profile TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, resource_type, resource_id)
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
      "INSERT INTO telemetry_resource_sequences VALUES ('service', 0), ('check', 0)",
    ),
    database.prepare(
      "INSERT INTO machines VALUES ('machine-1', 'workspace-1', 'Edge node', 1, 1, NULL)",
    ),
    database.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 'workspace-1', 'active')"),
  ]);
  await telemetryDatabase.batch([
    telemetryDatabase.prepare(
      `CREATE TABLE check_latest (
        check_pk INTEGER PRIMARY KEY,
        service_pk INTEGER NOT NULL,
        state TEXT NOT NULL,
        critical INTEGER NOT NULL
      )`,
    ),
    telemetryDatabase.prepare(
      `CREATE TABLE service_latest (
        service_pk INTEGER PRIMARY KEY,
        workspace_pk INTEGER NOT NULL,
        state TEXT NOT NULL,
        status_since INTEGER NOT NULL,
        reason_code TEXT NOT NULL,
        last_transition_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
    telemetryDatabase.prepare(
      `CREATE TABLE state_events (
        workspace_pk INTEGER NOT NULL,
        resource_type INTEGER NOT NULL,
        resource_pk INTEGER NOT NULL,
        occurred_at INTEGER NOT NULL,
        event_id BLOB NOT NULL,
        previous_state TEXT NOT NULL,
        current_state TEXT NOT NULL,
        reason_code TEXT NOT NULL
      )`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

async function first<T>(query: string): Promise<T | null> {
  return database.prepare(query).first<T>();
}

async function seedServiceChecks(): Promise<void> {
  await database.batch([
    database.prepare("INSERT INTO workspaces VALUES ('workspace-1', 1, NULL)"),
    database.prepare(
      `INSERT INTO services
        (id, telemetry_pk, workspace_id, name, slug, description, status_rule_json,
         maintenance_until, created_at, updated_at, deleted_at)
       VALUES ('service-1', 10, 'workspace-1', 'API', 'api', '', '{}', NULL, 1, 1, NULL)`,
    ),
    database.prepare(
      `INSERT INTO check_configs VALUES
        ('check-a', 101, 'workspace-1', 'service-1', 'A', 'http', 'cloudflare', NULL,
         0, 1, 60, 1, 5000, 0, 1, '{}', '{}', 2, 2, 512, 0, 1, 1),
        ('check-b', 102, 'workspace-1', 'service-1', 'B', 'http', 'cloudflare', NULL,
         0, 1, 60, 2, 5000, 0, 1, '{}', '{}', 2, 2, 512, 0, 1, 1)`,
    ),
  ]);
}

function setMemberAccess(machineCapability: "view" | "manage"): void {
  vi.mocked(loadMonitoringAccess).mockResolvedValue({
    workspaceId: "workspace-1",
    workspacePk: 1,
    defaultDashboardId: "dashboard-1",
    defaultSamplingIntervalSeconds: 60,
    role: "member",
    grants: [
      {
        resourceType: "service",
        resourceId: "service-1",
        capability: "manage",
        effect: "allow",
      },
      {
        resourceType: "machine",
        resourceId: "machine-1",
        capability: machineCapability,
        effect: "allow",
      },
    ],
  });
}

async function assignCheckToAgent(checkId: string, enabled = true): Promise<void> {
  await database
    .prepare(
      `UPDATE check_configs SET name = 'Agent check', executor_kind = 'agent',
         executor_agent_id = 'agent-1', assignment_revision = 1, enabled = ?
       WHERE id = ?`,
    )
    .bind(enabled ? 1 : 0, checkId)
    .run();
}

function synchronizeCheckCounts(db: D1Database, expectedReads: number): D1Database {
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
        if (!query.includes("SELECT COUNT(*) AS count FROM check_configs")) return statement;
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

function synchronizeAgentSnapshots(db: D1Database, expectedReads: number): D1Database {
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
        if (!query.includes("AS probe_count")) return statement;
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

async function seedAgentChecks(count: number, configBytes: number): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < count; index += 1) {
    statements.push(
      database
        .prepare(
          `INSERT INTO check_configs VALUES
            (?, ?, 'workspace-1', 'seed-service', ?, 'http', 'agent', 'agent-1',
             1, 1, 60, 0, 5000, 0, 1, '{}', '{}', 2, 2, ?, 0, 1, 1)`,
        )
        .bind(`seed-${index}`, 1_000 + index, `Seed ${index}`, configBytes),
    );
  }
  await database.batch(statements);
}

async function concurrentAgentServiceCreates(): Promise<
  PromiseSettledResult<{ serviceId: string }>[]
> {
  const synchronized = synchronizeAgentSnapshots(database, 2);
  return Promise.allSettled([
    createServiceMonitor(synchronized, "operations", "user-1", "unused", {
      ...input,
      name: "Public API A",
    }),
    createServiceMonitor(synchronized, "operations", "user-1", "unused", {
      ...input,
      name: "Public API B",
    }),
  ]);
}

describe("Agent executor authorization", () => {
  it("lists only Agents whose machines the member can manage", async () => {
    await seedServiceChecks();
    setMemberAccess("view");

    await expect(
      listServiceCheckAgents(database, "operations", "user-1", "service-1"),
    ).resolves.toEqual([]);

    setMemberAccess("manage");
    await expect(
      listServiceCheckAgents(database, "operations", "user-1", "service-1"),
    ).resolves.toEqual([{ id: "agent-1", name: "Edge node" }]);
  });

  it("requires machine manage permission before adding an Agent check", async () => {
    await seedServiceChecks();
    setMemberAccess("view");

    await expect(
      addServiceCheck(database, "operations", "user-1", "unused", "service-1", {
        ...input,
        checkName: "Private endpoint",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM check_configs"),
    ).resolves.toEqual({ count: 2 });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 1 });

    setMemberAccess("manage");
    await expect(
      addServiceCheck(database, "operations", "user-1", "unused", "service-1", {
        ...input,
        checkName: "Private endpoint",
      }),
    ).resolves.toMatchObject({ checkId: expect.any(String) });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 2 });
  });

  it("requires machine manage permission before replacing an Agent target", async () => {
    await seedServiceChecks();
    await assignCheckToAgent("check-a");
    setMemberAccess("view");

    await expect(
      replaceServiceCheckConfiguration(
        database,
        "operations",
        "user-1",
        "unused",
        "service-1",
        "check-a",
        { ...input, checkName: "Agent check", replaceSecrets: false },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 1 });
  });

  it("requires machine manage permission for enabled policy changes but permits disabling", async () => {
    await seedServiceChecks();
    await assignCheckToAgent("check-a");
    setMemberAccess("view");
    const policy = {
      enabled: true,
      intervalSeconds: 30,
      timeoutMs: 5_000,
      retryCount: 0,
      failureConfirmations: 2,
      recoveryConfirmations: 2,
      critical: true,
    };

    await expect(
      updateServiceCheckPolicy(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-a",
        policy,
      ),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      updateServiceCheckPolicy(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-a",
        { ...policy, enabled: false },
      ),
    ).resolves.toBeUndefined();
    await expect(
      first<{ enabled: number }>("SELECT enabled FROM check_configs WHERE id = 'check-a'"),
    ).resolves.toEqual({ enabled: 0 });
  });

  it("rejects an inactive Agent for execution while preserving revocation paths", async () => {
    await seedServiceChecks();
    await assignCheckToAgent("check-a");
    await database.prepare("UPDATE agents SET status = 'revoked' WHERE id = 'agent-1'").run();
    setMemberAccess("manage");
    const policy = {
      enabled: true,
      intervalSeconds: 60,
      timeoutMs: 5_000,
      retryCount: 0,
      failureConfirmations: 2,
      recoveryConfirmations: 2,
      critical: true,
    };

    await expect(
      updateServiceCheckPolicy(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-a",
        policy,
      ),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      updateServiceCheckPolicy(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-a",
        { ...policy, enabled: false },
      ),
    ).resolves.toBeUndefined();
    await expect(
      first<{ enabled: number }>("SELECT enabled FROM check_configs WHERE id = 'check-a'"),
    ).resolves.toEqual({ enabled: 0 });

    await expect(
      deleteServiceCheck(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-a",
      ),
    ).resolves.toBeUndefined();
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM check_configs WHERE id = 'check-a'"),
    ).resolves.toEqual({ count: 0 });
  });
});

describe("Agent check configuration revision", () => {
  it("commits the machine and assigned check revision together", async () => {
    await expect(
      createServiceMonitor(database, "operations", "user-1", "unused", input),
    ).resolves.toMatchObject({ serviceId: expect.any(String) });

    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 2 });
    await expect(
      first<{ revision: number }>(
        "SELECT assignment_revision AS revision FROM check_configs LIMIT 1",
      ),
    ).resolves.toEqual({ revision: 2 });
  });

  it("rolls the machine revision back when a later configuration write fails", async () => {
    await database
      .prepare(
        `CREATE TRIGGER reject_dashboard_resource BEFORE INSERT ON dashboard_resources
         BEGIN SELECT RAISE(ABORT, 'forced dashboard failure'); END`,
      )
      .run();

    await expect(
      createServiceMonitor(database, "operations", "user-1", "unused", input),
    ).rejects.toThrow();
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 1 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM services"),
    ).resolves.toEqual({ count: 0 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM check_configs"),
    ).resolves.toEqual({ count: 0 });
  });

  it("serializes the 32 enabled check limit", async () => {
    await seedAgentChecks(31, 512);
    const outcomes = await concurrentAgentServiceCreates();

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM check_configs WHERE executor_agent_id = 'agent-1' AND enabled = 1",
      ),
    ).resolves.toEqual({ count: 32 });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 2 });
  });

  it("serializes the 44 KiB Agent configuration limit", async () => {
    await seedAgentChecks(1, 44 * 1024 - 600);
    const outcomes = await concurrentAgentServiceCreates();

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM check_configs WHERE executor_agent_id = 'agent-1' AND enabled = 1",
      ),
    ).resolves.toEqual({ count: 2 });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 2 });
  });
});

describe("service check invariants", () => {
  it("prevents concurrent policy updates from disabling every check", async () => {
    await seedServiceChecks();
    const synchronized = synchronizeCheckCounts(database, 2);
    const policy = {
      enabled: false,
      intervalSeconds: 60,
      timeoutMs: 5_000,
      retryCount: 0,
      failureConfirmations: 2,
      recoveryConfirmations: 2,
      critical: true,
    };
    const outcomes = await Promise.allSettled([
      updateServiceCheckPolicy(
        synchronized,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-a",
        policy,
      ),
      updateServiceCheckPolicy(
        synchronized,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-b",
        policy,
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM check_configs WHERE enabled = 1"),
    ).resolves.toEqual({ count: 1 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 1 });
  });

  it("prevents concurrent deletes from removing every check", async () => {
    await seedServiceChecks();
    const synchronized = synchronizeCheckCounts(database, 2);
    const outcomes = await Promise.allSettled([
      deleteServiceCheck(
        synchronized,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-a",
      ),
      deleteServiceCheck(
        synchronized,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        "check-b",
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM check_configs"),
    ).resolves.toEqual({ count: 1 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 1 });
  });
});

describe("service public access persistence", () => {
  it("updates the resource policy, dashboard, and audit together", async () => {
    await database.batch([
      database.prepare("INSERT INTO workspaces VALUES ('workspace-1', 1, NULL)"),
      database.prepare(
        `INSERT INTO services
          (id, telemetry_pk, workspace_id, name, slug, description, status_rule_json,
           maintenance_until, created_at, updated_at, deleted_at)
         VALUES ('service-1', 10, 'workspace-1', 'API', 'api', '', '{}', NULL, 1, 1, NULL)`,
      ),
      database.prepare(
        "INSERT INTO dashboards VALUES ('dashboard-1', 'workspace-1', 'private', 1)",
      ),
    ]);

    await expect(
      setServicePublicAccess(database, "operations", "user-1", "service-1", true),
    ).resolves.toBeUndefined();
    await expect(
      first<{ effect: string }>(
        "SELECT effect FROM resource_public_policies WHERE resource_id = 'service-1'",
      ),
    ).resolves.toEqual({ effect: "allow" });
    await expect(
      first<{ visibility: string }>("SELECT visibility FROM dashboards WHERE id = 'dashboard-1'"),
    ).resolves.toEqual({ visibility: "public" });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 1 });
  });
});
