import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitoring-access.js", () => ({
  loadMonitoringAccess: vi.fn(async () => ({ workspaceId: "workspace-1" })),
  requireAdmin: vi.fn(),
  requireResourceCapability: vi.fn(),
}));

import { restoreResource, revokeMachineEnrollmentToken, softDeleteResource } from "./resources.js";
import { revokeWorkspaceInvitation } from "./workspace-invitations.js";
import { restoreWorkspace, softDeleteWorkspace } from "./workspace-lifecycle.js";

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
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        purge_started_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE retention_policies (
        workspace_id TEXT PRIMARY KEY,
        soft_delete_grace_days INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        purge_started_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE workspace_invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        accepted_at INTEGER,
        revoked_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE agent_enrollment_tokens (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL
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
      `INSERT INTO workspaces VALUES
        ('workspace-1', 'Operations', 'operations', 1, NULL, NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES
        ('workspace-1', 'user-1', 'admin', 'active')`,
    ),
    database.prepare(`INSERT INTO retention_policies VALUES ('workspace-1', 7)`),
    database.prepare(
      `INSERT INTO machines VALUES ('machine-1', 'workspace-1', 'Edge', 1, NULL, NULL)`,
    ),
    database.prepare(
      `INSERT INTO workspace_invitations VALUES
        ('invitation-1', 'workspace-1', 'member', 4102444800000, NULL, NULL)`,
    ),
    database.prepare(
      `INSERT INTO agent_enrollment_tokens VALUES
        ('token-1', 'workspace-1', 'machine-1', 4102444800000, NULL, NULL, 1)`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

function mutateBeforeBatch(db: D1Database, mutation: string): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property !== "batch") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async <T>(statements: D1PreparedStatement[]) => {
        await target.prepare(mutation).run();
        return target.batch<T>(statements);
      };
    },
  });
}

async function expectNoAuditRows(): Promise<void> {
  await expect(
    database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
  ).resolves.toEqual({ count: 0 });
}

describe("stale lifecycle mutations", () => {
  it("rejects resource deletion after another request deletes it", async () => {
    const stale = mutateBeforeBatch(
      database,
      "UPDATE machines SET deleted_at = 10 WHERE id = 'machine-1'",
    );

    await expect(
      softDeleteResource(stale, "operations", "user-1", "machine", "machine-1"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database
        .prepare("SELECT deleted_at FROM machines WHERE id = 'machine-1'")
        .first<{ deleted_at: number }>(),
    ).resolves.toEqual({ deleted_at: 10 });
    await expectNoAuditRows();
  });

  it("rejects resource restoration after another request restores it", async () => {
    const deletedAt = Date.now() - 1_000;
    await database
      .prepare("UPDATE machines SET deleted_at = ? WHERE id = 'machine-1'")
      .bind(deletedAt)
      .run();
    const stale = mutateBeforeBatch(
      database,
      "UPDATE machines SET deleted_at = NULL WHERE id = 'machine-1'",
    );

    await expect(
      restoreResource(stale, "operations", "user-1", "machine", "machine-1"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database
        .prepare("SELECT deleted_at FROM machines WHERE id = 'machine-1'")
        .first<{ deleted_at: number | null }>(),
    ).resolves.toEqual({ deleted_at: null });
    await expectNoAuditRows();
  });

  it("rejects resource restoration after retention claims finalization", async () => {
    const deletedAt = Date.now() - 1_000;
    await database
      .prepare("UPDATE machines SET deleted_at = ? WHERE id = 'machine-1'")
      .bind(deletedAt)
      .run();
    const stale = mutateBeforeBatch(
      database,
      "UPDATE machines SET purge_started_at = 1 WHERE id = 'machine-1'",
    );

    await expect(
      restoreResource(stale, "operations", "user-1", "machine", "machine-1"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database
        .prepare("SELECT deleted_at, purge_started_at FROM machines WHERE id = 'machine-1'")
        .first<{ deleted_at: number; purge_started_at: number }>(),
    ).resolves.toEqual({ deleted_at: deletedAt, purge_started_at: 1 });
    await expectNoAuditRows();
  });

  it("rejects workspace deletion after another request deletes it", async () => {
    const stale = mutateBeforeBatch(
      database,
      "UPDATE workspaces SET deleted_at = 10 WHERE id = 'workspace-1'",
    );

    await expect(
      softDeleteWorkspace(stale, "operations", "user-1", "operations"),
    ).rejects.toMatchObject({ status: 409 });
    await expectNoAuditRows();
  });

  it("rejects workspace deletion after the actor loses administrator access", async () => {
    const stale = mutateBeforeBatch(
      database,
      "UPDATE memberships SET role = 'member' WHERE workspace_id = 'workspace-1' AND user_id = 'user-1'",
    );

    await expect(
      softDeleteWorkspace(stale, "operations", "user-1", "operations"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database
        .prepare("SELECT deleted_at FROM workspaces WHERE id = 'workspace-1'")
        .first<{ deleted_at: number | null }>(),
    ).resolves.toEqual({ deleted_at: null });
    await expectNoAuditRows();
  });

  it("rejects workspace restoration after another request restores it", async () => {
    const deletedAt = Date.now() - 1_000;
    await database
      .prepare("UPDATE workspaces SET deleted_at = ? WHERE id = 'workspace-1'")
      .bind(deletedAt)
      .run();
    const stale = mutateBeforeBatch(
      database,
      "UPDATE workspaces SET deleted_at = NULL WHERE id = 'workspace-1'",
    );

    await expect(restoreWorkspace(stale, "workspace-1", "user-1")).rejects.toMatchObject({
      status: 409,
    });
    await expectNoAuditRows();
  });

  it("rejects workspace restoration after the actor loses administrator access", async () => {
    const deletedAt = Date.now() - 1_000;
    await database
      .prepare("UPDATE workspaces SET deleted_at = ? WHERE id = 'workspace-1'")
      .bind(deletedAt)
      .run();
    const stale = mutateBeforeBatch(
      database,
      "UPDATE memberships SET role = 'member' WHERE workspace_id = 'workspace-1' AND user_id = 'user-1'",
    );

    await expect(restoreWorkspace(stale, "workspace-1", "user-1")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      database
        .prepare("SELECT deleted_at FROM workspaces WHERE id = 'workspace-1'")
        .first<{ deleted_at: number | null }>(),
    ).resolves.toEqual({ deleted_at: deletedAt });
    await expectNoAuditRows();
  });

  it("rejects workspace restoration after retention claims finalization", async () => {
    const deletedAt = Date.now() - 1_000;
    await database
      .prepare("UPDATE workspaces SET deleted_at = ? WHERE id = 'workspace-1'")
      .bind(deletedAt)
      .run();
    const stale = mutateBeforeBatch(
      database,
      "UPDATE workspaces SET purge_started_at = 1 WHERE id = 'workspace-1'",
    );

    await expect(restoreWorkspace(stale, "workspace-1", "user-1")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      database
        .prepare("SELECT deleted_at, purge_started_at FROM workspaces WHERE id = 'workspace-1'")
        .first<{ deleted_at: number; purge_started_at: number }>(),
    ).resolves.toEqual({ deleted_at: deletedAt, purge_started_at: 1 });
    await expectNoAuditRows();
  });

  it("rejects invitation revocation after another request revokes it", async () => {
    const stale = mutateBeforeBatch(
      database,
      "UPDATE workspace_invitations SET revoked_at = 10 WHERE id = 'invitation-1'",
    );

    await expect(
      revokeWorkspaceInvitation(stale, "operations", "user-1", "invitation-1"),
    ).rejects.toMatchObject({ status: 409 });
    await expectNoAuditRows();
  });

  it("rejects enrollment revocation after another request revokes it", async () => {
    const stale = mutateBeforeBatch(
      database,
      "UPDATE agent_enrollment_tokens SET revoked_at = 10 WHERE id = 'token-1'",
    );

    await expect(
      revokeMachineEnrollmentToken(stale, "operations", "user-1", "machine-1", "token-1"),
    ).rejects.toMatchObject({ status: 409 });
    await expectNoAuditRows();
  });
});
