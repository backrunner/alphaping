import { error } from "@sveltejs/kit";

import { prepareAuditStatement } from "./workspace-admin.js";

interface WorkspaceMembershipRow {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "member";
  deleted_at: number | null;
  soft_delete_grace_days: number | null;
}

export interface WorkspaceMembershipSummary {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "member";
  deletedAt: number | null;
  recoverableUntil: number | null;
}

export async function listUserWorkspaces(
  db: D1Database,
  userId: string,
): Promise<readonly WorkspaceMembershipSummary[]> {
  const rows = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, m.role, w.deleted_at, p.soft_delete_grace_days
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
       LEFT JOIN retention_policies p ON p.workspace_id = w.id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY w.deleted_at IS NOT NULL, w.name LIMIT 200`,
    )
    .bind(userId)
    .all<WorkspaceMembershipRow>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
    deletedAt: row.deleted_at,
    recoverableUntil:
      row.deleted_at === null
        ? null
        : row.deleted_at + (row.soft_delete_grace_days ?? 7) * 86_400_000,
  }));
}

export async function softDeleteWorkspace(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  confirmation: string,
): Promise<void> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, w.deleted_at, m.role
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE w.slug = ? AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, actorUserId)
    .first<{
      id: string;
      name: string;
      slug: string;
      deleted_at: number | null;
      role: "admin" | "member";
    }>();
  if (!workspace || workspace.role !== "admin" || workspace.deleted_at !== null) {
    throw error(404, "Workspace not found");
  }
  if (confirmation !== workspace.slug) throw error(400, "Workspace confirmation does not match");
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE workspaces SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(now, now, workspace.id),
    await prepareAuditStatement(db, {
      workspaceId: workspace.id,
      actorUserId,
      action: "workspace.delete",
      resourceType: "workspace",
      resourceId: workspace.id,
      before: { name: workspace.name, slug: workspace.slug, deletedAt: null },
      after: { name: workspace.name, slug: workspace.slug, deletedAt: now },
      now,
    }),
  ]);
}

export async function restoreWorkspace(
  db: D1Database,
  workspaceId: string,
  actorUserId: string,
): Promise<{ slug: string }> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, w.deleted_at, m.role, p.soft_delete_grace_days
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       LEFT JOIN retention_policies p ON p.workspace_id = w.id
       WHERE w.id = ? AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceId, actorUserId)
    .first<{
      id: string;
      name: string;
      slug: string;
      deleted_at: number | null;
      role: "admin" | "member";
      soft_delete_grace_days: number | null;
    }>();
  if (!workspace || workspace.role !== "admin" || workspace.deleted_at === null) {
    throw error(404, "Workspace not found");
  }
  const now = Date.now();
  const graceDays = workspace.soft_delete_grace_days ?? 7;
  if (workspace.deleted_at <= now - graceDays * 86_400_000) {
    throw error(409, "The workspace recovery window has expired");
  }
  await db.batch([
    db
      .prepare(
        `UPDATE workspaces SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?`,
      )
      .bind(now, workspace.id, workspace.deleted_at),
    await prepareAuditStatement(db, {
      workspaceId: workspace.id,
      actorUserId,
      action: "workspace.restore",
      resourceType: "workspace",
      resourceId: workspace.id,
      before: { name: workspace.name, slug: workspace.slug, deletedAt: workspace.deleted_at },
      after: { name: workspace.name, slug: workspace.slug, deletedAt: null },
      now,
    }),
  ]);
  return { slug: workspace.slug };
}
