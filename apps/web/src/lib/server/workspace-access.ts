import { error } from "@sveltejs/kit";

import {
  prepareAuditStatement,
  requireWorkspaceAdmin,
  requireWorkspaceResource,
  type WorkspaceResourceType,
} from "./workspace-admin.js";

export type ResourcePermission = "none" | "view" | "manage" | "deny";

const PAGE_SIZE = 50;
const MAX_PAGE = 100;
const MAX_ENTRIES = PAGE_SIZE * MAX_PAGE;

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
  memberPagination: WorkspaceAccessPagination;
  invitationPagination: WorkspaceAccessPagination;
  resourcePagination: WorkspaceAccessPagination;
}

export interface WorkspaceAccessPagination {
  page: number;
  pages: number;
  total: number;
  totalCapped: boolean;
}

export interface WorkspaceAccessRequest {
  memberId?: string | null;
  memberPage?: number;
  invitationPage?: number;
  resourcePage?: number;
  now?: number;
}

function pagination(count: number, requestedPage: number | undefined): WorkspaceAccessPagination {
  const requested = Number.isInteger(requestedPage)
    ? Math.min(MAX_PAGE, Math.max(1, requestedPage ?? 1))
    : 1;
  const totalCapped = count > MAX_ENTRIES;
  const total = Math.min(count, MAX_ENTRIES);
  const pages = Math.max(1, Math.min(MAX_PAGE, Math.ceil(total / PAGE_SIZE)));
  return { page: Math.min(requested, pages), pages, total, totalCapped };
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
  request: WorkspaceAccessRequest = {},
): Promise<WorkspaceAccessPanel> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const [memberCount, invitationCount, resourceCount] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT 1 FROM memberships m JOIN user u ON u.id = m.user_id
           WHERE m.workspace_id = ? AND m.status IN ('active', 'suspended') LIMIT ?
         )`,
      )
      .bind(access.workspaceId, MAX_ENTRIES + 1)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT 1 FROM workspace_invitations
           WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL LIMIT ?
         )`,
      )
      .bind(access.workspaceId, MAX_ENTRIES + 1)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT 1 FROM (
             SELECT id FROM machines WHERE workspace_id = ? AND deleted_at IS NULL
             UNION ALL
             SELECT id FROM services WHERE workspace_id = ? AND deleted_at IS NULL
             UNION ALL
             SELECT id FROM containers WHERE workspace_id = ? AND deleted_at IS NULL
           ) LIMIT ?
         )`,
      )
      .bind(access.workspaceId, access.workspaceId, access.workspaceId, MAX_ENTRIES + 1)
      .first<{ count: number }>(),
  ]);
  if (!memberCount || !invitationCount || !resourceCount) {
    throw error(500, "Workspace access counts are unavailable");
  }
  const memberPagination = pagination(memberCount.count, request.memberPage);
  const invitationPagination = pagination(invitationCount.count, request.invitationPage);
  const resourcePagination = pagination(resourceCount.count, request.resourcePage);
  const [memberRows, invitationRows, resourceRows] = await Promise.all([
    db
      .prepare(
        `SELECT m.user_id, u.name, u.email, m.role, m.status, m.created_at
         FROM memberships m JOIN user u ON u.id = m.user_id
         WHERE m.workspace_id = ? AND m.status IN ('active', 'suspended')
         ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END, u.name, u.email, m.user_id
         LIMIT ? OFFSET ?`,
      )
      .bind(access.workspaceId, PAGE_SIZE, (memberPagination.page - 1) * PAGE_SIZE)
      .all<MemberRow>(),
    db
      .prepare(
        `SELECT id, email, role, expires_at, created_at FROM workspace_invitations
         WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .bind(access.workspaceId, PAGE_SIZE, (invitationPagination.page - 1) * PAGE_SIZE)
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
         ) ORDER BY resource_type, name, resource_id LIMIT ? OFFSET ?`,
      )
      .bind(
        access.workspaceId,
        access.workspaceId,
        access.workspaceId,
        PAGE_SIZE,
        (resourcePagination.page - 1) * PAGE_SIZE,
      )
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
  const selectedMemberId = selectableMembers.some((member) => member.id === request.memberId)
    ? (request.memberId ?? null)
    : (selectableMembers[0]?.id ?? null);
  const resourceIds = resourceRows.results.map((resource) => resource.resource_id);
  const grantRows =
    selectedMemberId && resourceIds.length > 0
      ? await db
          .prepare(
            `SELECT resource_type, resource_id, capability, effect FROM resource_grants
           WHERE workspace_id = ? AND subject_user_id = ?
             AND resource_type IN ('machine', 'service', 'container')
             AND resource_id IN (${resourceIds.map(() => "?").join(", ")})`,
          )
          .bind(access.workspaceId, selectedMemberId, ...resourceIds)
          .all<GrantRow>()
      : { results: [] as GrantRow[] };
  const grantsByResource = new Map<string, GrantRow[]>();
  for (const grant of grantRows.results) {
    const key = `${grant.resource_type}:${grant.resource_id}`;
    const grants = grantsByResource.get(key) ?? [];
    grants.push(grant);
    grantsByResource.set(key, grants);
  }
  return {
    members,
    invitations: invitationRows.results.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
      expired: invitation.expires_at <= (request.now ?? Date.now()),
    })),
    selectedMemberId,
    resources: resourceRows.results.map((resource) => ({
      id: resource.resource_id,
      type: resource.resource_type,
      name: resource.name,
      permission: permissionFromGrants(
        grantsByResource.get(`${resource.resource_type}:${resource.resource_id}`) ?? [],
      ),
    })),
    memberPagination,
    invitationPagination,
    resourcePagination,
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
    onlyIfPreviousStatementChanged: true,
  });
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE memberships SET role = ?, status = ?, updated_at = ?
         WHERE workspace_id = ? AND user_id = ? AND role = ? AND status = ?
           AND EXISTS (
             SELECT 1 FROM memberships actor
             WHERE actor.workspace_id = memberships.workspace_id AND actor.user_id = ?
               AND actor.role = 'admin' AND actor.status = 'active'
           )
           AND (
             ? = 0 OR EXISTS (
               SELECT 1 FROM memberships replacement
               WHERE replacement.workspace_id = memberships.workspace_id
                 AND replacement.user_id != memberships.user_id
                 AND replacement.role = 'admin' AND replacement.status = 'active'
             )
           )`,
      )
      .bind(
        input.role,
        input.status,
        now,
        access.workspaceId,
        input.memberId,
        member.role,
        member.status,
        actorUserId,
        removesActiveAdmin ? 1 : 0,
      ),
    audit,
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Workspace membership changed; reload and try again");
  }
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
  const resourceTable =
    input.resourceType === "machine"
      ? "machines"
      : input.resourceType === "service"
        ? "services"
        : "containers";
  const authorizationSql = `EXISTS (
    SELECT 1 FROM memberships actor
    WHERE actor.workspace_id = ? AND actor.user_id = ?
      AND actor.role = 'admin' AND actor.status = 'active'
  )
  AND EXISTS (
    SELECT 1 FROM memberships subject
    WHERE subject.workspace_id = ? AND subject.user_id = ?
      AND subject.role = 'member' AND subject.status IN ('active', 'suspended')
  )
  AND EXISTS (
    SELECT 1 FROM ${resourceTable} resource
    WHERE resource.id = ? AND resource.workspace_id = ? AND resource.deleted_at IS NULL
  )`;
  const authorizationBinds = [
    access.workspaceId,
    actorUserId,
    access.workspaceId,
    input.memberId,
    input.resourceId,
    access.workspaceId,
  ] as const;
  const guard = db
    .prepare(
      `UPDATE memberships SET updated_at = updated_at
       WHERE workspace_id = ? AND user_id = ? AND role = 'member'
         AND status IN ('active', 'suspended') AND ${authorizationSql}`,
    )
    .bind(access.workspaceId, input.memberId, ...authorizationBinds);
  const statements: D1PreparedStatement[] = [
    guard,
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId,
      action: "resource_grant.replace",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: existing.results,
      after: { memberId: input.memberId, permission: input.permission },
      now,
      onlyIfPreviousStatementChanged: true,
    }),
    db
      .prepare(
        `DELETE FROM resource_grants
         WHERE workspace_id = ? AND subject_user_id = ? AND resource_type = ? AND resource_id = ?
           AND ${authorizationSql}`,
      )
      .bind(
        access.workspaceId,
        input.memberId,
        input.resourceType,
        input.resourceId,
        ...authorizationBinds,
      ),
  ];
  const insert = (capability: "view" | "manage", effect: "allow" | "deny") =>
    db
      .prepare(
        `INSERT INTO resource_grants
          (id, workspace_id, subject_user_id, resource_type, resource_id, capability,
           effect, created_by, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${authorizationSql}`,
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
        ...authorizationBinds,
      );
  if (input.permission === "view") statements.push(insert("view", "allow"));
  if (input.permission === "manage") statements.push(insert("manage", "allow"));
  if (input.permission === "deny") {
    statements.push(insert("view", "deny"), insert("manage", "deny"));
  }
  const results = await db.batch(statements);
  if (results[0]?.meta.changes !== 1) {
    throw error(409, "Resource permission changed; reload and try again");
  }
}
