import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  finalizeDeletedWorkspace,
  finalizeSoftDeletedResources,
  type SoftDeletePolicy,
} from "./soft-delete";

const DAY_MS = 86_400_000;
const now = 100 * DAY_MS;
const policy: SoftDeletePolicy = {
  workspace_id: "workspace-1",
  workspace_pk: 1,
  workspace_deleted_at: null,
  soft_delete_grace_days: 7,
};

const controlTables = [
  "agents",
  "announcements",
  "check_configs",
  "check_secrets",
  "containers",
  "dashboard_resources",
  "dashboards",
  "incident_resources",
  "incidents",
  "machines",
  "resource_grants",
  "resource_public_policies",
  "services",
  "workspaces",
] as const;

const telemetryTables = [
  "agent_replay_state",
  "check_latest",
  "check_result_blocks_5m",
  "check_rollups_1h",
  "check_rollups_5m",
  "machine_latest",
  "machine_rollups_1h",
  "machine_rollups_5m",
  "service_latest",
  "state_events",
  "status_buckets",
  "telemetry_blocks_5m",
  "retention_cursors",
  "workspace_status_summary",
] as const;

beforeEach(async () => {
  await env.CONTROL_DB.batch([
    ...controlTables.map((table) => env.CONTROL_DB.prepare(`DROP TABLE IF EXISTS ${table}`)),
    env.CONTROL_DB.prepare(
      "CREATE TABLE machines (id TEXT PRIMARY KEY, telemetry_pk INTEGER, workspace_id TEXT, deleted_at INTEGER)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE services (id TEXT PRIMARY KEY, telemetry_pk INTEGER, workspace_id TEXT, deleted_at INTEGER)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE agents (id TEXT PRIMARY KEY, machine_id TEXT, created_at INTEGER)",
    ),
    env.CONTROL_DB.prepare(
      `CREATE TABLE check_configs (
        telemetry_pk INTEGER, service_id TEXT, secret_refs_json TEXT,
        enabled INTEGER, executor_agent_id TEXT
      )`,
    ),
    env.CONTROL_DB.prepare("CREATE TABLE check_secrets (id TEXT PRIMARY KEY, workspace_id TEXT)"),
    env.CONTROL_DB.prepare(
      "CREATE TABLE containers (id TEXT PRIMARY KEY, workspace_id TEXT, machine_id TEXT, deleted_at INTEGER)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE resource_grants (workspace_id TEXT, resource_type TEXT, resource_id TEXT)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE resource_public_policies (workspace_id TEXT, resource_type TEXT, resource_id TEXT)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE dashboard_resources (resource_type TEXT, resource_id TEXT)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE incident_resources (resource_type TEXT, resource_id TEXT)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE dashboards (id TEXT PRIMARY KEY, workspace_id TEXT, deleted_at INTEGER)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE incidents (id TEXT PRIMARY KEY, workspace_id TEXT, deleted_at INTEGER)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE announcements (id TEXT PRIMARY KEY, workspace_id TEXT, deleted_at INTEGER)",
    ),
    env.CONTROL_DB.prepare("CREATE TABLE workspaces (id TEXT PRIMARY KEY, deleted_at INTEGER)"),
  ]);
  await env.TELEMETRY_DB.batch([
    ...telemetryTables.map((table) => env.TELEMETRY_DB.prepare(`DROP TABLE IF EXISTS ${table}`)),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE agent_replay_state (agent_id TEXT, key_epoch INTEGER, PRIMARY KEY (agent_id, key_epoch))",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE telemetry_blocks_5m (machine_pk INTEGER, workspace_pk INTEGER, block_start INTEGER, PRIMARY KEY (machine_pk, block_start))",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE machine_rollups_5m (machine_pk INTEGER, workspace_pk INTEGER, bucket_start INTEGER, PRIMARY KEY (machine_pk, bucket_start))",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE machine_rollups_1h (machine_pk INTEGER, workspace_pk INTEGER, bucket_start INTEGER, PRIMARY KEY (machine_pk, bucket_start))",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE machine_latest (machine_pk INTEGER PRIMARY KEY, workspace_pk INTEGER)",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE check_result_blocks_5m (check_pk INTEGER, workspace_pk INTEGER, block_start INTEGER, PRIMARY KEY (check_pk, block_start))",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE check_rollups_5m (check_pk INTEGER, workspace_pk INTEGER, bucket_start INTEGER, PRIMARY KEY (check_pk, bucket_start))",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE check_rollups_1h (check_pk INTEGER, workspace_pk INTEGER, bucket_start INTEGER, PRIMARY KEY (check_pk, bucket_start))",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE check_latest (check_pk INTEGER PRIMARY KEY, workspace_pk INTEGER)",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE service_latest (service_pk INTEGER PRIMARY KEY, workspace_pk INTEGER)",
    ),
    env.TELEMETRY_DB.prepare(
      `CREATE TABLE state_events (
        workspace_pk INTEGER, resource_type INTEGER, resource_pk INTEGER,
        occurred_at INTEGER, event_id BLOB,
        PRIMARY KEY (resource_type, resource_pk, occurred_at, event_id)
      )`,
    ),
    env.TELEMETRY_DB.prepare(
      `CREATE TABLE status_buckets (
        workspace_pk INTEGER, resource_type INTEGER, resource_pk INTEGER,
        bucket_seconds INTEGER, bucket_start INTEGER,
        PRIMARY KEY (resource_type, resource_pk, bucket_seconds, bucket_start)
      )`,
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE retention_cursors (workspace_pk INTEGER, table_kind TEXT)",
    ),
    env.TELEMETRY_DB.prepare(
      "CREATE TABLE workspace_status_summary (workspace_pk INTEGER PRIMARY KEY)",
    ),
  ]);
});

async function count(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? 0;
}

describe("soft-delete finalization", () => {
  it("purges machine, service, replay, secret, and authorization rows", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("INSERT INTO machines VALUES ('machine-1', 1, 'workspace-1', ?)").bind(
        deletedAt,
      ),
      env.CONTROL_DB.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 1)"),
      env.CONTROL_DB.prepare("INSERT INTO services VALUES ('service-1', 2, 'workspace-1', ?)").bind(
        deletedAt,
      ),
      env.CONTROL_DB.prepare(
        `INSERT INTO check_configs VALUES (
          3, 'service-1', '{"headers":{"authorization":"secret-1"},"body":null,"tcpPayload":null}',
          1, NULL
        )`,
      ),
      env.CONTROL_DB.prepare("INSERT INTO check_secrets VALUES ('secret-1', 'workspace-1')"),
      env.CONTROL_DB.prepare(
        "INSERT INTO resource_grants VALUES ('workspace-1', 'machine', 'machine-1')",
      ),
      env.CONTROL_DB.prepare(
        "INSERT INTO resource_public_policies VALUES ('workspace-1', 'service', 'service-1')",
      ),
      env.CONTROL_DB.prepare("INSERT INTO dashboard_resources VALUES ('machine', 'machine-1')"),
      env.CONTROL_DB.prepare("INSERT INTO incident_resources VALUES ('service', 'service-1')"),
    ]);
    await env.TELEMETRY_DB.batch([
      env.TELEMETRY_DB.prepare("INSERT INTO agent_replay_state VALUES ('agent-1', 1)"),
      env.TELEMETRY_DB.prepare("INSERT INTO telemetry_blocks_5m VALUES (1, 1, 1)"),
      env.TELEMETRY_DB.prepare("INSERT INTO machine_latest VALUES (1, 1)"),
      env.TELEMETRY_DB.prepare("INSERT INTO check_result_blocks_5m VALUES (3, 1, 1)"),
      env.TELEMETRY_DB.prepare("INSERT INTO check_latest VALUES (3, 1)"),
      env.TELEMETRY_DB.prepare("INSERT INTO service_latest VALUES (2, 1)"),
      env.TELEMETRY_DB.prepare("INSERT INTO state_events VALUES (1, 1, 1, 1, X'01')"),
      env.TELEMETRY_DB.prepare("INSERT INTO state_events VALUES (1, 2, 2, 1, X'02')"),
    ]);

    await expect(finalizeSoftDeletedResources(env, policy, now)).resolves.toBeGreaterThan(0);
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(0);
    await expect(count(env.CONTROL_DB, "services")).resolves.toBe(0);
    await expect(count(env.CONTROL_DB, "check_secrets")).resolves.toBe(0);
    await expect(count(env.CONTROL_DB, "resource_grants")).resolves.toBe(0);
    await expect(count(env.CONTROL_DB, "resource_public_policies")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "agent_replay_state")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "telemetry_blocks_5m")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "check_result_blocks_5m")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "state_events")).resolves.toBe(0);
  });

  it("keeps the control row until every bounded telemetry batch is gone", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.prepare("INSERT INTO machines VALUES ('machine-1', 1, 'workspace-1', ?)")
      .bind(deletedAt)
      .run();
    const rows = Array.from({ length: 201 }, (_, index) =>
      env.TELEMETRY_DB.prepare("INSERT INTO telemetry_blocks_5m VALUES (1, 1, ?)").bind(index),
    );
    for (let offset = 0; offset < rows.length; offset += 50) {
      await env.TELEMETRY_DB.batch(rows.slice(offset, offset + 50));
    }

    await finalizeSoftDeletedResources(env, policy, now);
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "telemetry_blocks_5m")).resolves.toBe(1);

    await finalizeSoftDeletedResources(env, policy, now);
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "telemetry_blocks_5m")).resolves.toBe(0);
  });

  it("deletes a workspace only after child and telemetry rows are absent", async () => {
    const deletedAt = now - 8 * DAY_MS;
    const deletedPolicy = { ...policy, workspace_deleted_at: deletedAt };
    await env.CONTROL_DB.prepare("INSERT INTO workspaces VALUES ('workspace-1', ?)")
      .bind(deletedAt)
      .run();
    await env.TELEMETRY_DB.batch([
      env.TELEMETRY_DB.prepare("INSERT INTO workspace_status_summary VALUES (1)"),
      env.TELEMETRY_DB.prepare("INSERT INTO retention_cursors VALUES (1, 'event')"),
    ]);

    await expect(finalizeDeletedWorkspace(env, deletedPolicy, now)).resolves.toBe(3);
    await expect(count(env.CONTROL_DB, "workspaces")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "workspace_status_summary")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "retention_cursors")).resolves.toBe(0);
  });
});
