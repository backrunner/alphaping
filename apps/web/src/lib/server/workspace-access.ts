import { error } from "@sveltejs/kit";

import {
  prepareAuditStatement,
  requireWorkspaceAdmin,
  requireWorkspaceResource,
  type WorkspaceResourceType,
} from "./workspace-admin.js";

export type ResourcePermission = "none" | "view" | "manage" | "deny";

interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "suspended";
  created_at: number;
}

interface InvitationRow {
  id: string;
  email: string;
  role: "admin" | "member";
  expires_at: number;
  created_at: number;
}

interface ResourceRow {
  resource_type: WorkspaceResourceType;
  resource_id: string;
  name: string;
}

interface GrantRow {
  capability: "view" | "manage";
  effect: "allow" | "deny";
  resource_type: WorkspaceResourceType;
  resource_id: string;
}

export interface WorkspaceAccessMember {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "suspended";
  createdAt: number;
  current: boolean;
}

export interface WorkspaceAccessInvitation {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: number;
  createdAt: number;
  expired: boolean;
}

export interface WorkspaceAccessResource {
  id: string;
  type: WorkspaceResourceType;
  name: string;
  permission: ResourcePermission;
}

export interface WorkspaceAccessPanel {
  members: readonly WorkspaceAccessMember[];
  invitations: readonly WorkspaceAccessInvitation[];
  selectedMemberId: string | null;
  resources: readonly WorkspaceAccessResource[];
}

export function permissionFromGrants(grants: readonly GrantRow[]): ResourcePermission {
  if (grants.some((grant) => grant.effect === "deny")) return "deny";
  if (grants.some((grant) => grant.effect === "allow" && grant.capability === "manage")) {
    return "manage";
  }
  if (grants.some((grant) => grant.effect === "allow" && grant.capability === "view")) {
    return "view";
  }
  return "none";
}

export async function loadWorkspaceAccessPanel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  requestedMemberId: string | null,
  now = Date.now(),
): Promise<WorkspaceAccessPanel> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const [memberRows, invitationRows, resourceRows] = await Promise.all([
    db
      .prepare(
        `SELECT m.user_id, u.name, u.email, m.role, m.status, m.created_at
         FROM memberships m JOIN user u ON u.id = m.user_id
         WHERE m.workspace_id = ? AND m.status IN ('active', 'suspended')
         ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END, u.name, u.email LIMIT 100`,
      )
      .bind(access.workspaceId)
      .all<MemberRow>(),
    db
      .prepare(
        `SELECT id, email, role, expires_at, created_at FROM workspace_invitations
         WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(access.workspaceId)
      .all<InvitationRow>(),
    db
      .prepare(
        `SELECT resource_type, resource_id, name FROM (
           SELECT 'machine' AS resource_type, id AS resource_id, name FROM machines
           WHERE workspace_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT 'service' AS resource_type, id AS resource_id, name FROM services
           WHERE workspace_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT 'container' AS resource_type, id AS resource_id, name FROM containers
           WHERE workspace_id = ? AND deleted_at IS NULL
         ) ORDER BY resource_type, name LIMIT 200`,
      )
      .bind(access.workspaceId, access.workspaceId, access.workspaceId)
      .all<ResourceRow>(),
  ]);
  const members = memberRows.results.map<WorkspaceAccessMember>((member) => ({
    id: member.user_id,
    name: member.name,
    email: member.email,
    role: member.role,
    status: member.status,
    createdAt: member.created_at,
    current: member.user_id === userId,
  }));
  const selectableMembers = members.filter((member) => member.role === "member");
  const selectedMemberId = selectableMembers.some((member) => member.id === requestedMemberId)
    ? requestedMemberId
    : (selectableMembers[0]?.id ?? null);
  const grantRows = selectedMemberId
    ? await db
        .prepare(
          `SELECT resource_type, resource_id, capability, effect FROM resource_grants
           WHERE workspace_id = ? AND subject_user_id = ?
             AND resource_type IN ('machine', 'service', 'container')`,
        )
        .bind(access.workspaceId, selectedMemberId)
        .all<GrantRow>()
    : { results: [] as GrantRow[] };
  return {
    members,
    invitations: invitationRows.results.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
      expired: invitation.expires_at <= now,
    })),
    selectedMemberId,
    resources: resourceRows.results.map((resource) => ({
      id: resource.resource_id,
      type: resource.resource_type,
      name: resource.name,
      permission: permissionFromGrants(
        grantRows.results.filter(
          (grant) =>
            grant.resource_type === resource.resource_type &&
            grant.resource_id === resource.resource_id,
        ),
      ),
    })),
  };
}

export async function updateWorkspaceMembership(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  input: {
    memberId: string;
    role: "admin" | "member";
    status: "active" | "suspended";
  },
): Promise<void> {
  if (!(["admin", "member"] as const).includes(input.role)) throw error(400, "Role is invalid");
  if (!(["active", "suspended"] as const).includes(input.status)) {
    throw error(400, "Membership status is invalid");
  }
  const access = await requireWorkspaceAdmin(db, workspaceSlug, actorUserId);
  const member = await db
    .prepare(
      `SELECT role, status FROM memberships WHERE workspace_id = ? AND user_id = ?
       AND status IN ('active', 'suspended')`,
    )
    .bind(access.workspaceId, input.memberId)
    .first<{ role: "admin" | "member"; status: "active" | "suspended" }>();
  if (!member) throw error(404, "Member not found");
  if (input.memberId === actorUserId && (input.role !== "admin" || input.status !== "active")) {
    throw error(409, "You cannot remove your own active administrator access");
  }
  const removesActiveAdmin =
    member.role === "admin" &&
    member.status === "active" &&
    (input.role !== "admin" || input.status !== "active");
  if (removesActiveAdmin) {
    const administrators = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM memberships
         WHERE workspace_id = ? AND role = 'admin' AND status = 'active'`,
      )
      .bind(access.workspaceId)
      .first<{ count: number }>();
    if (!administrators || administrators.count <= 1) {
      throw error(409, "The workspace must keep at least one active administrator");
    }
  }
  const now = Date.now();
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId,
    action: "membership.update",
    resourceType: "membership",
    resourceId: input.memberId,
    before: member,
    after: { role: input.role, status: input.status },
    now,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE memberships SET role = ?, status = ?, updated_at = ?
         WHERE workspace_id = ? AND user_id = ?`,
      )
      .bind(input.role, input.status, now, access.workspaceId, input.memberId),
    audit,
  ]);
}

export async function setMemberResourcePermission(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  input: {
    memberId: string;
    resourceType: WorkspaceResourceType;
    resourceId: string;
    permission: ResourcePermission;
  },
): Promise<void> {
  if (!(["machine", "service", "container"] as const).includes(input.resourceType)) {
    throw error(400, "Resource type is invalid");
  }
  if (!(["none", "view", "manage", "deny"] as const).includes(input.permission)) {
    throw error(400, "Permission is invalid");
  }
  const access = await requireWorkspaceAdmin(db, workspaceSlug, actorUserId);
  const member = await db
    .prepare(
      `SELECT role, status FROM memberships WHERE workspace_id = ? AND user_id = ?
       AND status IN ('active', 'suspended')`,
    )
    .bind(access.workspaceId, input.memberId)
    .first<{ role: "admin" | "member"; status: "active" | "suspended" }>();
  if (!member || member.role !== "member") throw error(404, "Member not found");
  await requireWorkspaceResource(db, access.workspaceId, input.resourceType, input.resourceId);
  const existing = await db
    .prepare(
      `SELECT capability, effect FROM resource_grants
       WHERE workspace_id = ? AND subject_user_id = ? AND resource_type = ? AND resource_id = ?`,
    )
    .bind(access.workspaceId, input.memberId, input.resourceType, input.resourceId)
    .all<Pick<GrantRow, "capability" | "effect">>();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM resource_grants
         WHERE workspace_id = ? AND subject_user_id = ? AND resource_type = ? AND resource_id = ?`,
      )
      .bind(access.workspaceId, input.memberId, input.resourceType, input.resourceId),
  ];
  const insert = (capability: "view" | "manage", effect: "allow" | "deny") =>
    db
      .prepare(
        `INSERT INTO resource_grants
          (id, workspace_id, subject_user_id, resource_type, resource_id, capability,
           effect, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        access.workspaceId,
        input.memberId,
        input.resourceType,
        input.resourceId,
        capability,
        effect,
        actorUserId,
        now,
      );
  if (input.permission === "view") statements.push(insert("view", "allow"));
  if (input.permission === "manage") statements.push(insert("manage", "allow"));
  if (input.permission === "deny") {
    statements.push(insert("view", "deny"), insert("manage", "deny"));
  }
  statements.push(
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId,
      action: "resource_grant.replace",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: existing.results,
      after: { memberId: input.memberId, permission: input.permission },
      now,
    }),
  );
  await db.batch(statements);
}
