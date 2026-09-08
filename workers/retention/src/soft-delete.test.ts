import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  finalizeDeletedWorkspace,
  finalizeSoftDeletedResources,
  type SoftDeletePolicy,
} from "./soft-delete";
import { purgeMachineTelemetry, purgeServiceTelemetry } from "./soft-delete-telemetry";

const DAY_MS = 86_400_000;
const now = 100 * DAY_MS;
const policy: SoftDeletePolicy = {
  workspace_id: "workspace-1",
  workspace_pk: 1,
  workspace_deleted_at: null,
  workspace_purge_started_at: null,
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
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER, workspace_id TEXT, deleted_at INTEGER,
        purge_started_at INTEGER, purge_agent_cursor TEXT NOT NULL DEFAULT ''
      )`,
    ),
    env.CONTROL_DB.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER, workspace_id TEXT, deleted_at INTEGER,
        purge_started_at INTEGER, purge_check_cursor INTEGER NOT NULL DEFAULT 0
      )`,
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE agents (id TEXT PRIMARY KEY, machine_id TEXT, created_at INTEGER)",
    ),
    env.CONTROL_DB.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER, workspace_id TEXT,
        service_id TEXT REFERENCES services(id) ON DELETE CASCADE, secret_refs_json TEXT,
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
    env.CONTROL_DB.prepare(
      "CREATE TABLE workspaces (id TEXT PRIMARY KEY, deleted_at INTEGER, purge_started_at INTEGER)",
    ),
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

async function runInBatches(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += 50) {
    await db.batch(statements.slice(offset, offset + 50));
  }
}

describe("soft-delete finalization", () => {
  it("does not purge telemetry owned by another workspace", async () => {
    await env.TELEMETRY_DB.batch([
      env.TELEMETRY_DB.prepare("INSERT INTO machine_latest VALUES (99, 2)"),
      env.TELEMETRY_DB.prepare("INSERT INTO check_latest VALUES (199, 2)"),
      env.TELEMETRY_DB.prepare("INSERT INTO service_latest VALUES (299, 2)"),
      env.TELEMETRY_DB.prepare("INSERT INTO state_events VALUES (2, 2, 299, 1, X'01')"),
    ]);

    await expect(purgeMachineTelemetry(env.TELEMETRY_DB, 1, 99, [], 10)).resolves.toEqual({
      complete: true,
      deleted: 0,
    });
    await expect(purgeServiceTelemetry(env.TELEMETRY_DB, 1, 299, [199], 10)).resolves.toEqual({
      complete: true,
      deleted: 0,
    });
    await expect(count(env.TELEMETRY_DB, "machine_latest")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "check_latest")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "service_latest")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "state_events")).resolves.toBe(1);
  });

  it("purges machine, service, replay, secret, and authorization rows", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO machines VALUES ('machine-1', 1, 'workspace-1', ?, NULL, '')",
      ).bind(deletedAt),
      env.CONTROL_DB.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 1)"),
      env.CONTROL_DB.prepare(
        "INSERT INTO services VALUES ('service-1', 2, 'workspace-1', ?, NULL, 0)",
      ).bind(deletedAt),
      env.CONTROL_DB.prepare(
        `INSERT INTO check_configs VALUES (
          'check-1', 3, 'workspace-1', 'service-1',
          '{"headers":{"authorization":"secret-1"},"body":null,"tcpPayload":null}', 1, NULL
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
    await expect(count(env.CONTROL_DB, "check_configs")).resolves.toBe(0);
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
    await env.CONTROL_DB.prepare(
      "INSERT INTO machines VALUES ('machine-1', 1, 'workspace-1', ?, NULL, '')",
    )
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
    await expect(
      env.CONTROL_DB.prepare("SELECT purge_started_at FROM machines WHERE id = 'machine-1'").first<{
        purge_started_at: number;
      }>(),
    ).resolves.toEqual({ purge_started_at: now });

    await finalizeSoftDeletedResources(env, policy, now);
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "telemetry_blocks_5m")).resolves.toBe(0);
  });

  it("deletes a workspace only after child and telemetry rows are absent", async () => {
    const deletedAt = now - 8 * DAY_MS;
    const deletedPolicy = { ...policy, workspace_deleted_at: deletedAt };
    await env.CONTROL_DB.prepare("INSERT INTO workspaces VALUES ('workspace-1', ?, NULL)")
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

  it("does not purge children when a stale workspace policy loses the finalization claim", async () => {
    const deletedAt = now - 8 * DAY_MS;
    const stalePolicy = { ...policy, workspace_deleted_at: deletedAt };
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("INSERT INTO workspaces VALUES ('workspace-1', NULL, NULL)"),
      env.CONTROL_DB.prepare(
        "INSERT INTO machines VALUES ('machine-1', 1, 'workspace-1', NULL, NULL, '')",
      ),
    ]);
    await env.TELEMETRY_DB.prepare("INSERT INTO telemetry_blocks_5m VALUES (1, 1, 1)").run();

    await expect(finalizeSoftDeletedResources(env, stalePolicy, now)).resolves.toBe(0);
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "telemetry_blocks_5m")).resolves.toBe(1);
  });

  it("preserves authorization when a control-only resource is restored after candidate loading", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO containers VALUES ('container-1', 'workspace-1', 'machine-1', ?)",
      ).bind(deletedAt),
      env.CONTROL_DB.prepare(
        "INSERT INTO resource_grants VALUES ('workspace-1', 'container', 'container-1')",
      ),
      env.CONTROL_DB.prepare(
        "INSERT INTO resource_public_policies VALUES ('workspace-1', 'container', 'container-1')",
      ),
    ]);

    let restored = false;
    const racingControlDb = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property !== "prepare") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (query: string) => {
          const prepared = target.prepare(query);
          if (!query.includes("SELECT id FROM containers")) return prepared;
          return new Proxy(prepared, {
            get(statement, statementProperty) {
              if (statementProperty !== "bind") {
                const value = Reflect.get(statement, statementProperty);
                return typeof value === "function" ? value.bind(statement) : value;
              }
              return (...values: Parameters<D1PreparedStatement["bind"]>) => {
                const bound = statement.bind(...values);
                return new Proxy(bound, {
                  get(current, currentProperty) {
                    if (currentProperty !== "all") {
                      const value = Reflect.get(current, currentProperty);
                      return typeof value === "function" ? value.bind(current) : value;
                    }
                    return async <T>() => {
                      const result = await current.all<T>();
                      if (!restored) {
                        restored = true;
                        await target
                          .prepare(
                            "UPDATE containers SET deleted_at = NULL WHERE id = 'container-1'",
                          )
                          .run();
                      }
                      return result;
                    };
                  },
                });
              };
            },
          });
        };
      },
    });
    const racingEnv = new Proxy(env, {
      get(target, property) {
        return property === "CONTROL_DB" ? racingControlDb : Reflect.get(target, property);
      },
    });

    await expect(finalizeSoftDeletedResources(racingEnv, policy, now)).resolves.toBe(0);
    await expect(
      env.CONTROL_DB.prepare("SELECT deleted_at FROM containers WHERE id = 'container-1'").first<{
        deleted_at: number | null;
      }>(),
    ).resolves.toEqual({ deleted_at: null });
    await expect(count(env.CONTROL_DB, "resource_grants")).resolves.toBe(1);
    await expect(count(env.CONTROL_DB, "resource_public_policies")).resolves.toBe(1);
  });

  it("resumes machine replay cleanup across more than one related-resource page", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.prepare(
      "INSERT INTO machines VALUES ('machine-1', 1, 'workspace-1', ?, NULL, '')",
    )
      .bind(deletedAt)
      .run();
    const agentIds = Array.from(
      { length: 51 },
      (_, index) => `agent-${index.toString().padStart(3, "0")}`,
    );
    await runInBatches(
      env.CONTROL_DB,
      agentIds.map((agentId, index) =>
        env.CONTROL_DB.prepare("INSERT INTO agents VALUES (?, 'machine-1', ?)").bind(
          agentId,
          index,
        ),
      ),
    );
    await runInBatches(
      env.TELEMETRY_DB,
      agentIds.map((agentId) =>
        env.TELEMETRY_DB.prepare("INSERT INTO agent_replay_state VALUES (?, 1)").bind(agentId),
      ),
    );

    await finalizeSoftDeletedResources(env, policy, now);
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "agent_replay_state")).resolves.toBe(1);
    await expect(
      env.CONTROL_DB.prepare(
        "SELECT purge_agent_cursor FROM machines WHERE id = 'machine-1'",
      ).first<{ purge_agent_cursor: string }>(),
    ).resolves.toEqual({ purge_agent_cursor: "agent-049" });

    await finalizeSoftDeletedResources(env, policy, now);
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "agent_replay_state")).resolves.toBe(0);
  });

  it("resumes check cleanup across pages without leaving telemetry or secrets", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.prepare(
      "INSERT INTO services VALUES ('service-1', 2, 'workspace-1', ?, NULL, 0)",
    )
      .bind(deletedAt)
      .run();
    const checks = Array.from({ length: 51 }, (_, index) => ({
      id: `check-${index.toString().padStart(3, "0")}`,
      pk: index + 1,
      secretId: `secret-${index.toString().padStart(3, "0")}`,
    }));
    await runInBatches(
      env.CONTROL_DB,
      checks.flatMap((check) => [
        env.CONTROL_DB.prepare(
          `INSERT INTO check_configs VALUES (?, ?, 'workspace-1', 'service-1', ?, 1, NULL)`,
        ).bind(check.id, check.pk, JSON.stringify({ body: check.secretId })),
        env.CONTROL_DB.prepare("INSERT INTO check_secrets VALUES (?, 'workspace-1')").bind(
          check.secretId,
        ),
      ]),
    );
    await runInBatches(
      env.TELEMETRY_DB,
      checks.map((check) =>
        env.TELEMETRY_DB.prepare("INSERT INTO check_result_blocks_5m VALUES (?, 1, 1)").bind(
          check.pk,
        ),
      ),
    );

    await finalizeSoftDeletedResources(env, policy, now);
    await expect(count(env.CONTROL_DB, "services")).resolves.toBe(1);
    await expect(count(env.CONTROL_DB, "check_secrets")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "check_result_blocks_5m")).resolves.toBe(1);
    await expect(
      env.CONTROL_DB.prepare(
        "SELECT purge_check_cursor FROM services WHERE id = 'service-1'",
      ).first<{ purge_check_cursor: number }>(),
    ).resolves.toEqual({ purge_check_cursor: 50 });

    await finalizeSoftDeletedResources(env, policy, now);
    await expect(count(env.CONTROL_DB, "services")).resolves.toBe(0);
    await expect(count(env.CONTROL_DB, "check_configs")).resolves.toBe(0);
    await expect(count(env.CONTROL_DB, "check_secrets")).resolves.toBe(0);
    await expect(count(env.TELEMETRY_DB, "check_result_blocks_5m")).resolves.toBe(0);
  });

  it("fails closed when a machine replay cursor no longer names a related Agent", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO machines VALUES ('machine-1', 1, 'workspace-1', ?, NULL, 'missing-agent')",
      ).bind(deletedAt),
      env.CONTROL_DB.prepare("INSERT INTO agents VALUES ('agent-1', 'machine-1', 1)"),
    ]);
    await env.TELEMETRY_DB.prepare("INSERT INTO agent_replay_state VALUES ('agent-1', 1)").run();

    await expect(finalizeSoftDeletedResources(env, policy, now)).rejects.toThrow(
      "soft_delete_agent_cursor_invalid",
    );
    await expect(count(env.CONTROL_DB, "machines")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "agent_replay_state")).resolves.toBe(1);
  });

  it("fails closed when a service telemetry cursor no longer names a related check", async () => {
    const deletedAt = now - 8 * DAY_MS;
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO services VALUES ('service-1', 2, 'workspace-1', ?, NULL, 999)",
      ).bind(deletedAt),
      env.CONTROL_DB.prepare(
        `INSERT INTO check_configs VALUES
          ('check-1', 3, 'workspace-1', 'service-1', '{}', 1, NULL)`,
      ),
    ]);
    await env.TELEMETRY_DB.prepare("INSERT INTO check_result_blocks_5m VALUES (3, 1, 1)").run();

    await expect(finalizeSoftDeletedResources(env, policy, now)).rejects.toThrow(
      "soft_delete_check_cursor_invalid",
    );
    await expect(count(env.CONTROL_DB, "services")).resolves.toBe(1);
    await expect(count(env.CONTROL_DB, "check_configs")).resolves.toBe(1);
    await expect(count(env.TELEMETRY_DB, "check_result_blocks_5m")).resolves.toBe(1);
  });
});
