import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { acquireWorkspaceRetentionLease, releaseWorkspaceRetentionLease } from "./cursor";

beforeEach(async () => {
  await env.TELEMETRY_DB.batch([
    env.TELEMETRY_DB.prepare("DROP TABLE IF EXISTS retention_cursors"),
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
  ]);
});

describe("retention workspace lease", () => {
  it("rejects overlap and preserves the event cursor across release", async () => {
    const first = await acquireWorkspaceRetentionLease(env.TELEMETRY_DB, 7, 1_000);
    expect(first).toMatchObject({ workspacePk: 7, eventTimeCursor: 0 });
    await expect(acquireWorkspaceRetentionLease(env.TELEMETRY_DB, 7, 1_001)).resolves.toBeNull();
    if (!first) throw new Error("missing lease");

    await releaseWorkspaceRetentionLease(env.TELEMETRY_DB, first, 900, 1_100);
    const next = await acquireWorkspaceRetentionLease(env.TELEMETRY_DB, 7, 1_101);
    expect(next).toMatchObject({ workspacePk: 7, eventTimeCursor: 900 });
  });

  it("allows recovery after an abandoned lease expires", async () => {
    const first = await acquireWorkspaceRetentionLease(env.TELEMETRY_DB, 9, 5_000);
    expect(first).not.toBeNull();
    if (!first) throw new Error("missing lease");

    await expect(
      acquireWorkspaceRetentionLease(env.TELEMETRY_DB, 9, first.leaseUntil + 1),
    ).resolves.toMatchObject({ workspacePk: 9 });
  });
});
