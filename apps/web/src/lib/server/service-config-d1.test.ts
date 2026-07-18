import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitoring-access.js", () => ({
  loadMonitoringAccess: vi.fn(async () => ({
    workspaceId: "workspace-1",
    defaultDashboardId: "dashboard-1",
  })),
  requireAdmin: vi.fn(),
  requireResourceCapability: vi.fn(),
}));

vi.mock("./service-config-compiler.js", () => ({
  compileServiceConfig: vi.fn(async () => ({
    request: { kind: "http", url: "https://example.test/health" },
    assertions: [],
    secretRefs: { headers: {}, body: null, tcpPayload: null },
    secrets: [],
  })),
}));

import { createServiceMonitor } from "./service-config.js";

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
      `CREATE TABLE telemetry_resource_sequences (
        kind TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
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
      `CREATE TABLE services (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT NOT NULL,
        status_rule_json TEXT NOT NULL,
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
    database.prepare("INSERT INTO machines VALUES ('machine-1', 'workspace-1', 1, 1, NULL)"),
    database.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 'workspace-1', 'active')"),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

async function first<T>(query: string): Promise<T | null> {
  return database.prepare(query).first<T>();
}

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
});
