import { hashPassword } from "better-auth/crypto";
import { error } from "@sveltejs/kit";

import { maskEmail, prepareAuditStatement, requireWorkspaceAdmin } from "./workspace-admin.js";

interface InvitationRecord {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  email: string;
  role: "admin" | "member";
  expires_at: number;
  existing_user_id: string | null;
}

export interface WorkspaceInvitationPage {
  workspaceName: string;
  workspaceSlug: string;
  emailHint: string;
  role: "admin" | "member";
  expiresAt: number;
  expired: boolean;
  existingAccount: boolean;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw error(400, "A valid email address is required");
  }
  return normalized;
}

async function invitationDigest(token: string, secret: string): Promise<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || secret.length < 32) {
    throw error(404, "Invitation not found");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
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

async function invitationRecord(
  db: D1Database,
  token: string,
  secret: string,
  requireUnexpired: boolean,
  now: number,
): Promise<InvitationRecord> {
  const digest = await invitationDigest(token, secret);
  const invitation = await db
    .prepare(
      `SELECT i.id, i.workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
              i.email, i.role, i.expires_at,
              (SELECT id FROM user WHERE email = i.email LIMIT 1) AS existing_user_id
       FROM workspace_invitations i JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token_digest = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
         AND w.deleted_at IS NULL`,
    )
    .bind(digest)
    .first<InvitationRecord>();
  if (!invitation || (requireUnexpired && invitation.expires_at <= now)) {
    throw error(404, "Invitation not found");
  }
  return invitation;
}

export async function loadWorkspaceInvitation(
  db: D1Database,
  token: string,
  secret: string,
  now = Date.now(),
): Promise<WorkspaceInvitationPage> {
  const invitation = await invitationRecord(db, token, secret, false, now);
  return {
    workspaceName: invitation.workspace_name,
    workspaceSlug: invitation.workspace_slug,
    emailHint: maskEmail(invitation.email),
    role: invitation.role,
    expiresAt: invitation.expires_at,
    expired: invitation.expires_at <= now,
    existingAccount: invitation.existing_user_id !== null,
  };
}

export async function createWorkspaceInvitation(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  secret: string,
  input: { email: string; role: "admin" | "member" },
): Promise<{ id: string; token: string; expiresAt: number }> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, actorUserId);
  const email = normalizeEmail(input.email);
  if (input.role !== "admin" && input.role !== "member") throw error(400, "Role is invalid");
  const member = await db
    .prepare(
      `SELECT 1 AS present FROM memberships m JOIN user u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND u.email = ? LIMIT 1`,
    )
    .bind(access.workspaceId, email)
    .first<{ present: number }>();
  if (member) throw error(409, "This user already belongs to the workspace");
  const token = randomToken();
  const tokenDigest = await invitationDigest(token, secret);
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60_000;
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId,
    action: "workspace_invitation.create",
    resourceType: "workspace_invitation",
    resourceId: id,
    before: null,
    after: { role: input.role, expiresAt },
    now,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE workspace_invitations SET revoked_at = ?
         WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(now, access.workspaceId, email),
    db
      .prepare(
        `INSERT INTO workspace_invitations
          (id, workspace_id, email, role, token_digest, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, access.workspaceId, email, input.role, tokenDigest, expiresAt, actorUserId, now),
    audit,
  ]);
  return { id, token, expiresAt };
}

export async function revokeWorkspaceInvitation(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  invitationId: string,
): Promise<void> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, actorUserId);
  const invitation = await db
    .prepare(
      `SELECT id, role, expires_at FROM workspace_invitations
       WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    )
    .bind(invitationId, access.workspaceId)
    .first<{ id: string; role: "admin" | "member"; expires_at: number }>();
  if (!invitation) throw error(404, "Invitation not found");
  const now = Date.now();
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE workspace_invitations SET revoked_at = ?
         WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(now, invitationId, access.workspaceId),
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId,
      action: "workspace_invitation.revoke",
      resourceType: "workspace_invitation",
      resourceId: invitationId,
      before: { role: invitation.role, expiresAt: invitation.expires_at },
      after: { revokedAt: now },
      now,
      onlyIfPreviousStatementChanged: true,
    }),
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Invitation is no longer revocable");
  }
}

export async function acceptInvitationForUser(
  db: D1Database,
  token: string,
  secret: string,
  user: { id: string; email: string },
  now = Date.now(),
): Promise<{ workspaceSlug: string }> {
  const invitation = await invitationRecord(db, token, secret, true, now);
  if (normalizeEmail(user.email) !== invitation.email) {
    throw error(403, "Sign in with the email address that received this invitation");
  }
  const audit = await prepareAuditStatement(db, {
    workspaceId: invitation.workspace_id,
    actorUserId: user.id,
    action: "workspace_invitation.accept",
    resourceType: "workspace_invitation",
    resourceId: invitation.id,
    before: { accepted: false },
    after: { accepted: true, role: invitation.role },
    now,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE workspace_invitations SET accepted_at = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(now, invitation.id, now),
    db
      .prepare(
        `INSERT INTO memberships
          (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES (
           (SELECT workspace_id FROM workspace_invitations WHERE id = ? AND accepted_at = ?),
           ?,
           (SELECT role FROM workspace_invitations WHERE id = ? AND accepted_at = ?),
           'active', ?, ?
         )`,
      )
      .bind(invitation.id, now, user.id, invitation.id, now, now, now),
    audit,
  ]);
  return { workspaceSlug: invitation.workspace_slug };
}

export async function registerFromWorkspaceInvitation(
  db: D1Database,
  token: string,
  secret: string,
  input: { name: string; password: string },
  now = Date.now(),
): Promise<{ workspaceSlug: string; email: string }> {
  const invitation = await invitationRecord(db, token, secret, true, now);
  if (invitation.existing_user_id) {
    throw error(409, "An account already exists for this invitation; sign in to continue");
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw error(400, "Name must contain 2 to 80 characters");
  if (input.password.length < 12 || input.password.length > 128) {
    throw error(400, "Password must contain 12 to 128 characters");
  }
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);
  const audit = await prepareAuditStatement(db, {
    workspaceId: invitation.workspace_id,
    actorUserId: userId,
    action: "workspace_invitation.accept",
    resourceType: "workspace_invitation",
    resourceId: invitation.id,
    before: { accepted: false },
    after: { accepted: true, role: invitation.role },
    now,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE workspace_invitations SET accepted_at = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(now, invitation.id, now),
    db
      .prepare(
        `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(userId, name, invitation.email, now, now),
    db
      .prepare(
        `INSERT INTO account
          (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now),
    db
      .prepare(
        `INSERT INTO memberships
          (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES (
           (SELECT workspace_id FROM workspace_invitations WHERE id = ? AND accepted_at = ?),
           ?,
           (SELECT role FROM workspace_invitations WHERE id = ? AND accepted_at = ?),
           'active', ?, ?
         )`,
      )
      .bind(invitation.id, now, userId, invitation.id, now, now, now),
    audit,
  ]);
  return { workspaceSlug: invitation.workspace_slug, email: invitation.email };
}
