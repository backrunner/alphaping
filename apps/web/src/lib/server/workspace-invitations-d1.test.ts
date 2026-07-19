import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acceptInvitationForUser,
  loadWorkspaceInvitation,
  registerFromWorkspaceInvitation,
} from "./workspace-invitations.js";

const SECRET = "invitation-test-secret-that-is-at-least-32-bytes";
const TOKEN = "A".repeat(43);

let miniflare: Miniflare;
let database: D1Database;

async function tokenDigest(token: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`alphaping/workspace-invitation/v1:${token}`),
  );
}

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "workspace-invitations-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE user (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE account (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
        user_id TEXT NOT NULL, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      )`,
    ),
    database.prepare(
      `CREATE TABLE workspace_invitations (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL, token_digest BLOB NOT NULL, expires_at INTEGER NOT NULL,
        accepted_at INTEGER, revoked_at INTEGER, created_by TEXT, created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_user_id TEXT,
        action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
        before_digest TEXT, after_digest TEXT, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 'Operations', 'operations', NULL)`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

async function insertInvitation(email: string): Promise<void> {
  await database
    .prepare(
      `INSERT INTO workspace_invitations
       (id, workspace_id, email, role, token_digest, expires_at, accepted_at, revoked_at, created_by, created_at)
       VALUES (?, 'workspace-1', ?, 'member', ?, 4102444800000, NULL, NULL, NULL, 1)`,
    )
    .bind("invitation-1", email, await tokenDigest(TOKEN))
    .run();
}

describe("workspace invitation acceptance fencing", () => {
  it("reports a session email match without exposing the recipient address", async () => {
    await database
      .prepare("INSERT INTO user (id, name, email) VALUES ('user-1', 'One', 'one@example.com')")
      .run();
    await insertInvitation("one@example.com");

    await expect(
      loadWorkspaceInvitation(database, TOKEN, SECRET, 1_000, "ONE@example.com"),
    ).resolves.toMatchObject({
      existingAccount: true,
      recipientMatchesAuthenticatedEmail: true,
    });
    const mismatched = await loadWorkspaceInvitation(
      database,
      TOKEN,
      SECRET,
      1_000,
      "other@example.com",
    );
    expect(mismatched.recipientMatchesAuthenticatedEmail).toBe(false);
    expect(mismatched).not.toHaveProperty("email");
  });

  it("allows only one concurrent existing account acceptance", async () => {
    await database.batch([
      database.prepare(
        `INSERT INTO user (id, name, email) VALUES ('user-1', 'One', 'one@example.com')`,
      ),
      database.prepare(
        `INSERT INTO user (id, name, email) VALUES ('user-2', 'Two', 'one@example.com')`,
      ),
    ]);
    await insertInvitation("one@example.com");

    const outcomes = await Promise.allSettled([
      acceptInvitationForUser(
        database,
        TOKEN,
        SECRET,
        { id: "user-1", email: "one@example.com" },
        1_000,
      ),
      acceptInvitationForUser(
        database,
        TOKEN,
        SECRET,
        { id: "user-2", email: "one@example.com" },
        1_000,
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM memberships WHERE workspace_id = 'workspace-1'")
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
  });

  it("does not create a second account when registration races", async () => {
    await insertInvitation("new@example.com");

    const outcomes = await Promise.allSettled([
      registerFromWorkspaceInvitation(
        database,
        TOKEN,
        SECRET,
        { name: "New One", password: "correct-horse-battery-staple" },
        1_000,
      ),
      registerFromWorkspaceInvitation(
        database,
        TOKEN,
        SECRET,
        { name: "New Two", password: "correct-horse-battery-staple" },
        1_000,
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM user").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM memberships").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
  });
});
