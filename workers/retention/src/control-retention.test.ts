import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { cleanAgentCommands } from "./control-retention";

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
  ]);
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
