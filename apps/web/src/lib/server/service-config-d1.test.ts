import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileServiceStateSyncJobs } from "@alphaping/db";

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
  setServiceMaintenance,
  setServicePublicAccess,
  updateServiceCheckPolicy,
} from "./service-config.js";
import { compileServiceConfig, type CompiledServiceConfig } from "./service-config-compiler.js";
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
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL
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
        config_revision INTEGER NOT NULL DEFAULT 1,
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
      `CREATE TABLE service_state_sync_jobs (
        job_key TEXT PRIMARY KEY,
        sync_token TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        workspace_pk INTEGER NOT NULL,
        service_id TEXT NOT NULL,
        service_pk INTEGER NOT NULL,
        check_id TEXT,
        check_pk INTEGER,
        reason_code TEXT NOT NULL,
        protect_until INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        last_attempted_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_assertions (
        id TEXT PRIMARY KEY,
        check_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        source TEXT NOT NULL,
        operator TEXT NOT NULL,
        selector TEXT,
        expected_json TEXT NOT NULL,
        severity TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_secrets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        wrapped_value BLOB NOT NULL,
        wrapping_key_id TEXT NOT NULL,
        nonce BLOB NOT NULL,
        created_at INTEGER NOT NULL
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
    database.prepare("INSERT INTO memberships VALUES ('workspace-1', 'user-1', 'admin', 'active')"),
    database.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 'workspace-1', 'active')"),
  ]);
  await telemetryDatabase.batch([
    telemetryDatabase.prepare(
      `CREATE TABLE check_latest (
        check_pk INTEGER PRIMARY KEY,
        service_pk INTEGER NOT NULL,
        state TEXT NOT NULL,
        critical INTEGER NOT NULL,
        config_revision INTEGER NOT NULL DEFAULT 0
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
         1, 0, 1, 60, 1, 5000, 0, 1, '{}', '{}', 2, 2, 512, 0, 1, 1),
        ('check-b', 102, 'workspace-1', 'service-1', 'B', 'http', 'cloudflare', NULL,
         1, 0, 1, 60, 2, 5000, 0, 1, '{}', '{}', 2, 2, 512, 0, 1, 1)`,
    ),
  ]);
}

async function setMemberAccess(machineCapability: "view" | "manage"): Promise<void> {
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
  await database.batch([
    database.prepare(
      `UPDATE memberships SET role = 'member' WHERE workspace_id = 'workspace-1' AND user_id = 'user-1'`,
    ),
    database.prepare("DELETE FROM resource_grants WHERE subject_user_id = 'user-1'"),
    database.prepare(
      `INSERT INTO resource_grants VALUES
        ('workspace-1', 'user-1', 'service', 'service-1', 'manage', 'allow')`,
    ),
    database
      .prepare(
        `INSERT INTO resource_grants VALUES
          ('workspace-1', 'user-1', 'machine', 'machine-1', ?, 'allow')`,
      )
      .bind(machineCapability),
  ]);
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

function pauseNextBatch(db: D1Database): {
  db: D1Database;
  reached: Promise<void>;
  release: () => void;
} {
  let markReached: (() => void) | undefined;
  let releaseBatch: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseBatch = resolve;
  });
  return {
    db: new Proxy(db, {
      get(target, property) {
        if (property !== "batch") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (statements: D1PreparedStatement[]) => {
          markReached?.();
          await blocked;
          return target.batch(statements);
        };
      },
    }),
    reached,
    release: () => releaseBatch?.(),
  };
}

async function seedAgentChecks(count: number, configBytes: number): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < count; index += 1) {
    statements.push(
      database
        .prepare(
          `INSERT INTO check_configs VALUES
            (?, ?, 'workspace-1', 'seed-service', ?, 'http', 'agent', 'agent-1',
             1, 1, 1, 60, 0, 5000, 0, 1, '{}', '{}', 2, 2, ?, 0, 1, 1)`,
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
    await setMemberAccess("view");

    await expect(
      listServiceCheckAgents(database, "operations", "user-1", "service-1"),
    ).resolves.toEqual([]);

    await setMemberAccess("manage");
    await expect(
      listServiceCheckAgents(database, "operations", "user-1", "service-1"),
    ).resolves.toEqual([{ id: "agent-1", name: "Edge node" }]);
  });

  it("requires machine manage permission before adding an Agent check", async () => {
    await seedServiceChecks();
    await setMemberAccess("view");

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

    await setMemberAccess("manage");
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

  it("rejects an Agent check after its machine manage grant is revoked", async () => {
    await seedServiceChecks();
    await setMemberAccess("manage");
    const paused = pauseNextBatch(database);
    const pending = addServiceCheck(paused.db, "operations", "user-1", "unused", "service-1", {
      ...input,
      checkName: "Private endpoint",
    });
    await paused.reached;
    await database
      .prepare(
        `DELETE FROM resource_grants
         WHERE subject_user_id = 'user-1' AND resource_type = 'machine'`,
      )
      .run();
    paused.release();

    await expect(pending).rejects.toMatchObject({ status: 409 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM check_configs"),
    ).resolves.toEqual({ count: 2 });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 1 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 0 });
  });

  it("requires machine manage permission before replacing an Agent target", async () => {
    await seedServiceChecks();
    await assignCheckToAgent("check-a");
    await setMemberAccess("view");

    await expect(
      replaceServiceCheckConfiguration(
        database,
        telemetryDatabase,
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
    await setMemberAccess("view");
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
      first<{ enabled: number; config_revision: number }>(
        "SELECT enabled, config_revision FROM check_configs WHERE id = 'check-a'",
      ),
    ).resolves.toEqual({ enabled: 0, config_revision: 2 });
  });

  it("rejects an inactive Agent for execution while preserving revocation paths", async () => {
    await seedServiceChecks();
    await assignCheckToAgent("check-a");
    await database.prepare("UPDATE agents SET status = 'revoked' WHERE id = 'agent-1'").run();
    await setMemberAccess("manage");
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
  it("rejects service creation after the actor loses administrator access", async () => {
    const paused = pauseNextBatch(database);
    const pending = createServiceMonitor(paused.db, "operations", "user-1", "unused", input);
    await paused.reached;
    await database
      .prepare(
        `UPDATE memberships SET role = 'member'
         WHERE workspace_id = 'workspace-1' AND user_id = 'user-1'`,
      )
      .run();
    paused.release();

    await expect(pending).rejects.toMatchObject({ status: 409 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM services"),
    ).resolves.toEqual({ count: 0 });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 1 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 0 });
  });

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
  it("rejects a policy update after the actor loses service manage access", async () => {
    await seedServiceChecks();
    await setMemberAccess("manage");
    const paused = pauseNextBatch(database);
    const pending = updateServiceCheckPolicy(
      paused.db,
      telemetryDatabase,
      "operations",
      "user-1",
      "service-1",
      "check-a",
      {
        enabled: true,
        intervalSeconds: 120,
        timeoutMs: 5_000,
        retryCount: 0,
        failureConfirmations: 2,
        recoveryConfirmations: 2,
        critical: true,
      },
    );
    await paused.reached;
    await database
      .prepare(
        `DELETE FROM resource_grants
         WHERE subject_user_id = 'user-1' AND resource_type = 'service'`,
      )
      .run();
    paused.release();

    await expect(pending).rejects.toMatchObject({ status: 409 });
    await expect(
      first<{ interval_seconds: number }>(
        "SELECT interval_seconds FROM check_configs WHERE id = 'check-a'",
      ),
    ).resolves.toEqual({ interval_seconds: 60 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM service_state_sync_jobs"),
    ).resolves.toEqual({ count: 0 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 0 });
  });

  it("rejects a stale target replacement without mixing its assertions or secrets", async () => {
    await seedServiceChecks();
    await assignCheckToAgent("check-a");
    await setMemberAccess("manage");
    const oldReferences = {
      headers: { authorization: "secret-old" },
      body: null,
      tcpPayload: null,
    };
    await database.batch([
      database
        .prepare(
          "UPDATE check_configs SET request_json = ?, secret_refs_json = ? WHERE id = 'check-a'",
        )
        .bind(
          JSON.stringify({ kind: "http", url: "https://old.example.test" }),
          JSON.stringify(oldReferences),
        ),
      database.prepare(
        `INSERT INTO check_assertions
          (id, check_id, sort_order, source, operator, selector, expected_json, severity, created_at)
         VALUES ('assertion-old', 'check-a', 0, 'status', 'equals', NULL, '200', 'down', 1)`,
      ),
      database
        .prepare(
          `INSERT INTO check_secrets
            (id, workspace_id, name, wrapped_value, wrapping_key_id, nonce, created_at)
           VALUES ('secret-old', 'workspace-1', 'Authorization', ?, 'v1', ?, 1)`,
        )
        .bind(new Uint8Array([1]).buffer, new Uint8Array([2]).buffer),
    ]);
    const preserved: CompiledServiceConfig = {
      request: { kind: "http", url: "https://stale.example.test" },
      assertions: [
        {
          source: "body",
          operator: "contains",
          selector: null,
          expected: "stale",
          severity: "down",
        },
      ],
      secretRefs: { headers: {}, body: null, tcpPayload: null },
      secrets: [],
    };
    const replacement: CompiledServiceConfig = {
      request: { kind: "http", url: "https://current.example.test" },
      assertions: [
        {
          source: "body",
          operator: "contains",
          selector: null,
          expected: "current",
          severity: "down",
        },
      ],
      secretRefs: {
        headers: { authorization: "secret-current" },
        body: null,
        tcpPayload: null,
      },
      secrets: [
        {
          id: "secret-current",
          name: "Authorization",
          wrappedValue: new Uint8Array([3]).buffer,
          nonce: new Uint8Array([4]).buffer,
        },
      ],
    };
    vi.mocked(compileServiceConfig)
      .mockResolvedValueOnce(preserved)
      .mockResolvedValueOnce(replacement);
    const paused = pauseNextBatch(database);
    const staleReplacement = replaceServiceCheckConfiguration(
      paused.db,
      telemetryDatabase,
      "operations",
      "user-1",
      "unused",
      "service-1",
      "check-a",
      {
        ...input,
        checkName: "Stale target",
        retryCount: 0,
        replaceSecrets: false,
      },
    );
    await paused.reached;
    await expect(
      replaceServiceCheckConfiguration(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "unused",
        "service-1",
        "check-a",
        {
          ...input,
          checkName: "Current target",
          retryCount: 0,
          secretRequestHeaders: "Authorization: replacement",
          replaceSecrets: true,
        },
      ),
    ).resolves.toBeUndefined();
    paused.release();
    await expect(staleReplacement).rejects.toMatchObject({ status: 409 });

    await expect(
      first<{
        name: string;
        request_json: string;
        secret_refs_json: string;
        config_revision: number;
        assignment_revision: number;
      }>(
        `SELECT name, request_json, secret_refs_json, config_revision, assignment_revision
         FROM check_configs WHERE id = 'check-a'`,
      ),
    ).resolves.toEqual({
      name: "Current target",
      request_json: JSON.stringify(replacement.request),
      secret_refs_json: JSON.stringify(replacement.secretRefs),
      config_revision: 2,
      assignment_revision: 2,
    });
    await expect(
      first<{ revision: number }>(
        "SELECT desired_config_revision AS revision FROM machines WHERE id = 'machine-1'",
      ),
    ).resolves.toEqual({ revision: 2 });
    await expect(
      database
        .prepare(
          `SELECT source, operator, expected_json FROM check_assertions
           WHERE check_id = 'check-a' ORDER BY sort_order`,
        )
        .all(),
    ).resolves.toMatchObject({
      results: [{ source: "body", operator: "contains", expected_json: '"current"' }],
    });
    await expect(
      database.prepare("SELECT id FROM check_secrets ORDER BY id").all(),
    ).resolves.toMatchObject({ results: [{ id: "secret-current" }] });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 1 });
  });

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
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM service_state_sync_jobs"),
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
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM service_state_sync_jobs"),
    ).resolves.toEqual({ count: 1 });
  });
});

describe("service telemetry synchronization", () => {
  it("rejects maintenance after the actor loses service manage access", async () => {
    await seedServiceChecks();
    await setMemberAccess("manage");
    const paused = pauseNextBatch(database);
    const pending = setServiceMaintenance(
      paused.db,
      telemetryDatabase,
      "operations",
      "user-1",
      "service-1",
      Date.now() + 60_000,
    );
    await paused.reached;
    await database
      .prepare(
        `DELETE FROM resource_grants
         WHERE subject_user_id = 'user-1' AND resource_type = 'service'`,
      )
      .run();
    paused.release();

    await expect(pending).rejects.toMatchObject({ status: 409 });
    await expect(
      first<{ maintenance_until: number | null }>(
        "SELECT maintenance_until FROM services WHERE id = 'service-1'",
      ),
    ).resolves.toEqual({ maintenance_until: null });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM service_state_sync_jobs"),
    ).resolves.toEqual({ count: 0 });
  });

  it("increments a replaced central configuration and invalidates its old latest", async () => {
    await seedServiceChecks();
    await telemetryDatabase.batch([
      telemetryDatabase.prepare("INSERT INTO check_latest VALUES (101, 10, 'down', 1, 1)"),
      telemetryDatabase.prepare("INSERT INTO check_latest VALUES (102, 10, 'healthy', 1, 1)"),
      telemetryDatabase.prepare(
        "INSERT INTO service_latest VALUES (10, 1, 'down', 1, 'check_down', 1, 1)",
      ),
    ]);

    await expect(
      replaceServiceCheckConfiguration(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "unused",
        "service-1",
        "check-a",
        {
          ...input,
          checkName: "Replacement target",
          executorKind: "cloudflare",
          executorAgentId: "",
          retryCount: 0,
          replaceSecrets: false,
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      first<{ config_revision: number }>(
        "SELECT config_revision FROM check_configs WHERE id = 'check-a'",
      ),
    ).resolves.toEqual({ config_revision: 2 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM service_state_sync_jobs"),
    ).resolves.toEqual({ count: 1 });
    await expect(
      telemetryDatabase.prepare("SELECT check_pk FROM check_latest ORDER BY check_pk").all(),
    ).resolves.toMatchObject({ results: [{ check_pk: 102 }] });
    await expect(
      telemetryDatabase.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "healthy" });
  });

  it("commits policy changes and retains a retry job when TELEMETRY_DB is unavailable", async () => {
    await seedServiceChecks();
    await telemetryDatabase.batch([
      telemetryDatabase.prepare("INSERT INTO check_latest VALUES (101, 10, 'down', 1, 1)"),
      telemetryDatabase.prepare("INSERT INTO check_latest VALUES (102, 10, 'healthy', 1, 1)"),
      telemetryDatabase.prepare(
        "INSERT INTO service_latest VALUES (10, 1, 'down', 1, 'check_down', 1, 1)",
      ),
    ]);
    const failingTelemetry = new Proxy(telemetryDatabase, {
      get(target, property) {
        if (property === "prepare") {
          return () => {
            throw new Error("telemetry unavailable");
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      updateServiceCheckPolicy(
        database,
        failingTelemetry,
        "operations",
        "user-1",
        "service-1",
        "check-a",
        {
          enabled: false,
          intervalSeconds: 60,
          timeoutMs: 5_000,
          retryCount: 0,
          failureConfirmations: 2,
          recoveryConfirmations: 2,
          critical: true,
        },
      ),
    ).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(JSON.stringify({ event: "service_state_sync_deferred" }));
    await expect(
      first<{ enabled: number }>("SELECT enabled FROM check_configs WHERE id = 'check-a'"),
    ).resolves.toEqual({ enabled: 0 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM service_state_sync_jobs"),
    ).resolves.toEqual({ count: 1 });

    await expect(
      reconcileServiceStateSyncJobs(database, telemetryDatabase, Number.MAX_SAFE_INTEGER),
    ).resolves.toEqual({ processed: 1, completed: 1, failed: 0 });
    await expect(
      telemetryDatabase.prepare("SELECT check_pk FROM check_latest ORDER BY check_pk").all(),
    ).resolves.toMatchObject({ results: [{ check_pk: 102 }] });
    await expect(
      telemetryDatabase.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "healthy" });
  });

  it("persists maintenance synchronization with the control mutation", async () => {
    await seedServiceChecks();
    await telemetryDatabase
      .prepare("INSERT INTO check_latest VALUES (101, 10, 'healthy', 1, 1)")
      .run();
    const maintenanceUntil = Date.now() + 60 * 60_000;

    await expect(
      setServiceMaintenance(
        database,
        telemetryDatabase,
        "operations",
        "user-1",
        "service-1",
        maintenanceUntil,
      ),
    ).resolves.toBeUndefined();
    await expect(
      first<{ count: number; protect_until: number }>(
        "SELECT COUNT(*) AS count, MAX(protect_until) AS protect_until FROM service_state_sync_jobs",
      ),
    ).resolves.toEqual({ count: 1, protect_until: maintenanceUntil });
    await expect(
      telemetryDatabase.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "maintenance" });
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

  it("rejects a public access update after the actor loses administrator access", async () => {
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
    const paused = pauseNextBatch(database);
    const pending = setServicePublicAccess(paused.db, "operations", "user-1", "service-1", true);
    await paused.reached;
    await database
      .prepare(
        `UPDATE memberships SET role = 'member'
         WHERE workspace_id = 'workspace-1' AND user_id = 'user-1'`,
      )
      .run();
    paused.release();

    await expect(pending).rejects.toMatchObject({ status: 409 });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM resource_public_policies"),
    ).resolves.toEqual({ count: 0 });
    await expect(
      first<{ visibility: string }>("SELECT visibility FROM dashboards WHERE id = 'dashboard-1'"),
    ).resolves.toEqual({ visibility: "private" });
    await expect(
      first<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs"),
    ).resolves.toEqual({ count: 0 });
  });
});
