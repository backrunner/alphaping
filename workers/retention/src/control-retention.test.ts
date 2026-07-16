import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { cleanAgentCommands, cleanAuditLogs, cleanExpiredAnnouncements } from "./control-retention";

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
