import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanTelemetryTarget,
  DAY_MS,
  MACHINE_RAW_TARGET,
  type RetentionPolicyRow,
} from "./telemetry-retention";

const policy: RetentionPolicyRow = {
  workspace_id: "workspace-1",
  workspace_pk: 1,
  raw_days: 1,
  rollup_5m_days: 7,
  rollup_1h_days: 30,
  event_days: 30,
};

beforeEach(async () => {
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS machines"),
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS workspaces"),
    env.CONTROL_DB.prepare(
      "CREATE TABLE workspaces (id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL)",
    ),
    env.CONTROL_DB.prepare(
      "CREATE TABLE machines (telemetry_pk INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL)",
    ),
    env.CONTROL_DB.prepare("INSERT INTO workspaces (id, telemetry_pk) VALUES ('workspace-1', 1)"),
    env.CONTROL_DB.prepare(
      "INSERT INTO machines (telemetry_pk, workspace_id) VALUES (1, 'workspace-1')",
    ),
    env.CONTROL_DB.prepare(
      "INSERT INTO machines (telemetry_pk, workspace_id) VALUES (2, 'workspace-1')",
    ),
  ]);
  await env.TELEMETRY_DB.batch([
    env.TELEMETRY_DB.prepare("DROP TABLE IF EXISTS telemetry_blocks_5m"),
    env.TELEMETRY_DB.prepare("DROP TABLE IF EXISTS retention_cursors"),
    env.TELEMETRY_DB.prepare(
      `CREATE TABLE telemetry_blocks_5m (
        machine_pk INTEGER NOT NULL,
        workspace_pk INTEGER NOT NULL,
        block_start INTEGER NOT NULL,
        PRIMARY KEY (machine_pk, block_start)
      ) WITHOUT ROWID`,
    ),
    env.TELEMETRY_DB.prepare(
      `CREATE TABLE retention_cursors (
        workspace_pk INTEGER NOT NULL,
        table_kind TEXT NOT NULL,
        resource_pk INTEGER NOT NULL DEFAULT 0,
        time_cursor INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_pk, table_kind)
      ) WITHOUT ROWID`,
    ),
    env.TELEMETRY_DB.prepare(
      "INSERT INTO telemetry_blocks_5m (machine_pk, workspace_pk, block_start) VALUES (1, 1, 1)",
    ),
    env.TELEMETRY_DB.prepare(
      "INSERT INTO telemetry_blocks_5m (machine_pk, workspace_pk, block_start) VALUES (1, 1, 2)",
    ),
    env.TELEMETRY_DB.prepare(
      "INSERT INTO telemetry_blocks_5m (machine_pk, workspace_pk, block_start) VALUES (1, 1, 3)",
    ),
    env.TELEMETRY_DB.prepare(
      "INSERT INTO telemetry_blocks_5m (machine_pk, workspace_pk, block_start) VALUES (2, 1, 1)",
    ),
  ]);
});

describe("telemetry retention cursor", () => {
  it("does not advance past a resource while its delete batch is full", async () => {
    const now = 10 * DAY_MS;
    await expect(cleanTelemetryTarget(env, policy, MACHINE_RAW_TARGET, now, 40, 2)).resolves.toBe(
      2,
    );
    const firstCursor = await env.TELEMETRY_DB.prepare(
      "SELECT resource_pk FROM retention_cursors WHERE workspace_pk = 1 AND table_kind = 'machine_raw'",
    ).first<{ resource_pk: number }>();
    expect(firstCursor?.resource_pk).toBe(0);

    await expect(cleanTelemetryTarget(env, policy, MACHINE_RAW_TARGET, now, 40, 2)).resolves.toBe(
      2,
    );
    const remaining = await env.TELEMETRY_DB.prepare(
      "SELECT COUNT(*) AS count FROM telemetry_blocks_5m",
    ).first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });
});
