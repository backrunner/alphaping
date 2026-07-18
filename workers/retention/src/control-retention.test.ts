import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanAgentCommands,
  cleanAuditLogs,
  cleanExpiredAnnouncements,
  cleanOrphanCheckSecrets,
} from "./control-retention";

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS agent_commands"),
    env.CONTROL_DB.prepare(
      `CREATE TABLE agent_commands (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        completed_at INTEGER,
        result_code TEXT
      )`,
    ),
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS announcements"),
    env.CONTROL_DB.prepare(
      `CREATE TABLE announcements (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    ),
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS audit_logs"),
    env.CONTROL_DB.prepare(
      `CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ),
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS check_configs"),
    env.CONTROL_DB.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        secret_refs_json TEXT NOT NULL
      )`,
    ),
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS check_secrets"),
    env.CONTROL_DB.prepare(
      `CREATE TABLE check_secrets (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ),
  ]);
});

describe("workspace control retention", () => {
  it("uses configured announcement and audit windows in bounded batches", async () => {
    const now = 100 * DAY_MS;
    const announcement = env.CONTROL_DB.prepare(
      "INSERT INTO announcements (id, workspace_id, expires_at) VALUES (?, 'workspace-1', ?)",
    );
    const audit = env.CONTROL_DB.prepare(
      "INSERT INTO audit_logs (id, workspace_id, created_at) VALUES (?, 'workspace-1', ?)",
    );
    await env.CONTROL_DB.batch([
      announcement.bind("old-announcement", now - 8 * DAY_MS),
      announcement.bind("recent-announcement", now - 2 * DAY_MS),
      audit.bind("old-audit", now - 31 * DAY_MS),
      audit.bind("recent-audit", now - 10 * DAY_MS),
    ]);

    await expect(cleanExpiredAnnouncements(env.CONTROL_DB, "workspace-1", now, 7, 1)).resolves.toBe(
      1,
    );
    await expect(cleanAuditLogs(env.CONTROL_DB, "workspace-1", now, 30, 1)).resolves.toBe(1);
    const remainingAnnouncements = await env.CONTROL_DB.prepare(
      "SELECT id FROM announcements ORDER BY id",
    ).all<{ id: string }>();
    const remainingAudit = await env.CONTROL_DB.prepare(
      "SELECT id FROM audit_logs ORDER BY id",
    ).all<{ id: string }>();
    expect(remainingAnnouncements.results).toEqual([{ id: "recent-announcement" }]);
    expect(remainingAudit.results).toEqual([{ id: "recent-audit" }]);
  });

  it("deletes only aged unreferenced check secrets in bounded workspace batches", async () => {
    const now = 100 * DAY_MS;
    const insertSecret = env.CONTROL_DB.prepare(
      "INSERT INTO check_secrets (id, workspace_id, created_at) VALUES (?, ?, ?)",
    );
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        `INSERT INTO check_configs (id, workspace_id, secret_refs_json)
         VALUES ('check-1', 'workspace-1', ?)`,
      ).bind(
        JSON.stringify({
          headers: { authorization: "referenced-header" },
          body: "referenced-body",
          tcpPayload: "referenced-tcp",
        }),
      ),
      env.CONTROL_DB.prepare(
        `INSERT INTO check_configs (id, workspace_id, secret_refs_json)
         VALUES ('malformed-check', 'workspace-1', '{')`,
      ),
      insertSecret.bind("orphan-a", "workspace-1", now - 2 * DAY_MS),
      insertSecret.bind("orphan-b", "workspace-1", now - 2 * DAY_MS),
      insertSecret.bind("orphan-c", "workspace-1", now - 2 * DAY_MS),
      insertSecret.bind("recent-orphan", "workspace-1", now - 1_000),
      insertSecret.bind("referenced-header", "workspace-1", now - 2 * DAY_MS),
      insertSecret.bind("referenced-body", "workspace-1", now - 2 * DAY_MS),
      insertSecret.bind("referenced-tcp", "workspace-1", now - 2 * DAY_MS),
      insertSecret.bind("other-workspace", "workspace-2", now - 2 * DAY_MS),
    ]);

    await expect(cleanOrphanCheckSecrets(env.CONTROL_DB, "workspace-1", now, 2)).resolves.toBe(2);
    await expect(cleanOrphanCheckSecrets(env.CONTROL_DB, "workspace-1", now, 2)).resolves.toBe(1);
    const remaining = await env.CONTROL_DB.prepare("SELECT id FROM check_secrets ORDER BY id").all<{
      id: string;
    }>();
    expect(remaining.results).toEqual([
      { id: "other-workspace" },
      { id: "recent-orphan" },
      { id: "referenced-body" },
      { id: "referenced-header" },
      { id: "referenced-tcp" },
    ]);
  });
});

describe("Agent command retention", () => {
  it("deletes old audit rows and marks recent expirations in bounded batches", async () => {
    const now = 100 * DAY_MS;
    const insert = env.CONTROL_DB.prepare(
      `INSERT INTO agent_commands (id, state, expires_at, completed_at, result_code)
       VALUES (?, ?, ?, ?, NULL)`,
    );
    await env.CONTROL_DB.batch([
      insert.bind("old-pending", "pending", now - 31 * DAY_MS, null),
      insert.bind("old-done", "succeeded", now - 40 * DAY_MS, now - 31 * DAY_MS),
      insert.bind("recent-pending", "delivered", now - 1_000, null),
      insert.bind("future", "pending", now + DAY_MS, null),
      insert.bind("recent-done", "failed", now - DAY_MS, now - DAY_MS),
    ]);

    await expect(cleanAgentCommands(env.CONTROL_DB, now, 10)).resolves.toEqual({
      deleted: 2,
      expired: 1,
    });
    const rows = await env.CONTROL_DB.prepare(
      "SELECT id, state, completed_at, result_code FROM agent_commands ORDER BY id",
    ).all<{
      id: string;
      state: string;
      completed_at: number | null;
      result_code: string | null;
    }>();
    expect(rows.results).toEqual([
      { id: "future", state: "pending", completed_at: null, result_code: null },
      {
        id: "recent-done",
        state: "failed",
        completed_at: now - DAY_MS,
        result_code: null,
      },
      {
        id: "recent-pending",
        state: "expired",
        completed_at: now - 1_000,
        result_code: "command_expired",
      },
    ]);
  });
});
