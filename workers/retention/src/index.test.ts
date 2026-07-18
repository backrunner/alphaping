import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  loadRetentionPolicyBatch,
  processRetentionPolicies,
  resolveRetentionWorkspaceCursor,
} from "./index";

beforeEach(async () => {
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS retention_policies"),
    env.CONTROL_DB.prepare("DROP TABLE IF EXISTS workspaces"),
    env.CONTROL_DB.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        telemetry_pk INTEGER NOT NULL,
        deleted_at INTEGER,
        purge_started_at INTEGER
      )`,
    ),
    env.CONTROL_DB.prepare(
      `CREATE TABLE retention_policies (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        raw_days INTEGER NOT NULL,
        rollup_5m_days INTEGER NOT NULL,
        rollup_1h_days INTEGER NOT NULL,
        event_days INTEGER NOT NULL,
        audit_log_days INTEGER NOT NULL,
        expired_announcement_grace_days INTEGER NOT NULL,
        soft_delete_grace_days INTEGER NOT NULL
      )`,
    ),
  ]);
  await env.TELEMETRY_DB.batch([
    env.TELEMETRY_DB.prepare("DROP TABLE IF EXISTS retention_runs"),
    env.TELEMETRY_DB.prepare(
      `CREATE TABLE retention_runs (
        run_id TEXT PRIMARY KEY NOT NULL,
        completed_at INTEGER,
        error_code TEXT,
        workspace_cursor INTEGER NOT NULL DEFAULT 0
      )`,
    ),
  ]);
  for (let workspacePk = 1; workspacePk <= 3; workspacePk += 1) {
    const workspaceId = `workspace-${workspacePk}`;
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("INSERT INTO workspaces (id, telemetry_pk) VALUES (?, ?)").bind(
        workspaceId,
        workspacePk,
      ),
      env.CONTROL_DB.prepare(
        `INSERT INTO retention_policies
          (workspace_id, raw_days, rollup_5m_days, rollup_1h_days, event_days,
           audit_log_days, expired_announcement_grace_days, soft_delete_grace_days)
         VALUES (?, 7, 30, 365, 365, 365, 7, 7)`,
      ).bind(workspaceId),
    ]);
  }
});

describe("retention policy scheduler", () => {
  it("rotates bounded workspace batches and restarts after the final page", async () => {
    await env.TELEMETRY_DB.prepare(
      `INSERT INTO retention_runs (run_id, completed_at, error_code, workspace_cursor)
       VALUES ('retention:1752580800000', 1, NULL, 0)`,
    ).run();

    const first = await loadRetentionPolicyBatch(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      "retention:1752584400000",
      2,
    );
    expect(first.policies.map(({ workspace_pk }) => workspace_pk)).toEqual([1, 2]);
    expect(first.workspaceCursor).toBe(0);
    expect(first.nextWorkspaceCursor).toBe(2);
    await env.TELEMETRY_DB.prepare(
      `INSERT INTO retention_runs (run_id, completed_at, error_code, workspace_cursor)
       VALUES ('retention:1752584400000', 2, NULL, ?)`,
    )
      .bind(first.nextWorkspaceCursor)
      .run();

    const second = await loadRetentionPolicyBatch(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      "retention:1752588000000",
      2,
    );
    expect(second.policies.map(({ workspace_pk }) => workspace_pk)).toEqual([3]);
    expect(second.workspaceCursor).toBe(2);
    expect(second.nextWorkspaceCursor).toBe(0);
    await env.TELEMETRY_DB.prepare(
      `INSERT INTO retention_runs (run_id, completed_at, error_code, workspace_cursor)
       VALUES ('retention:1752588000000', 3, NULL, ?)`,
    )
      .bind(second.nextWorkspaceCursor)
      .run();

    const restarted = await loadRetentionPolicyBatch(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      "retention:1752591600000",
      2,
    );
    expect(restarted.policies.map(({ workspace_pk }) => workspace_pk)).toEqual([1, 2]);
  });

  it("ignores the cursor from a failed run", async () => {
    await env.TELEMETRY_DB.batch([
      env.TELEMETRY_DB.prepare(
        `INSERT INTO retention_runs (run_id, completed_at, error_code, workspace_cursor)
         VALUES ('retention:1752580800000', 1, NULL, 1)`,
      ),
      env.TELEMETRY_DB.prepare(
        `INSERT INTO retention_runs (run_id, completed_at, error_code, workspace_cursor)
         VALUES ('retention:1752584400000', 2, 'retention_failed', 3)`,
      ),
    ]);

    const batch = await loadRetentionPolicyBatch(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      "retention:1752588000000",
      2,
    );
    expect(batch.policies.map(({ workspace_pk }) => workspace_pk)).toEqual([2, 3]);
  });

  it("does not advance past a workspace skipped by an overlapping lease", async () => {
    await env.TELEMETRY_DB.prepare(
      `INSERT INTO retention_runs (run_id, completed_at, error_code, workspace_cursor)
       VALUES ('retention:1752580800000', 1, NULL, 1)`,
    ).run();

    const batch = await loadRetentionPolicyBatch(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      "retention:1752584400000",
      1,
    );
    expect(batch.workspaceCursor).toBe(1);
    expect(batch.nextWorkspaceCursor).toBe(2);
    expect(resolveRetentionWorkspaceCursor(batch, 1)).toBe(1);
    expect(resolveRetentionWorkspaceCursor(batch, 0)).toBe(2);
  });

  it("stops before the wall-time reserve and retains every unprocessed workspace", async () => {
    let processed = 0;
    const batch = await loadRetentionPolicyBatch(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      "retention:1752584400000",
      3,
    );
    const progress = await processRetentionPolicies(
      batch.policies,
      () => processed < 1,
      async () => {
        processed += 1;
        return { deletedRows: 2, processed: true };
      },
    );

    expect(progress).toEqual({
      deletedRows: 2,
      skippedWorkspaces: 2,
      deadlineReached: true,
    });
    expect(resolveRetentionWorkspaceCursor(batch, progress.skippedWorkspaces)).toBe(0);
  });
});
