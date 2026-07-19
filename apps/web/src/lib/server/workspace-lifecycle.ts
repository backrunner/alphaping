import { error } from "@sveltejs/kit";

import { prepareAuditStatement } from "./workspace-admin.js";

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  rawDays: number;
  defaultSamplingIntervalSeconds: number;
  dashboardVisibility: "private" | "authenticated" | "public";
}

function normalizeWorkspaceInput(input: CreateWorkspaceInput): CreateWorkspaceInput {
  const name = input.name.trim();
  const slug = input.slug.trim();
  if (name.length < 2 || name.length > 80) throw error(400, "Workspace name is invalid");
  if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)) {
    throw error(400, "Workspace slug is invalid");
  }
  if (!Number.isInteger(input.rawDays) || input.rawDays < 1 || input.rawDays > 90) {
    throw error(400, "Raw retention must be between 1 and 90 days");
  }
  if (
    !Number.isInteger(input.defaultSamplingIntervalSeconds) ||
    input.defaultSamplingIntervalSeconds < 5 ||
    input.defaultSamplingIntervalSeconds > 300 ||
    60 % input.defaultSamplingIntervalSeconds !== 0
  ) {
    throw error(400, "Default sampling interval must divide the 60 second report period");
  }
  if (!(["private", "authenticated", "public"] as const).includes(input.dashboardVisibility)) {
    throw error(400, "Dashboard visibility is invalid");
  }
  return { ...input, name, slug };
}

export async function createWorkspace(
  db: D1Database,
  actorUserId: string,
  input: CreateWorkspaceInput,
): Promise<{ id: string; slug: string }> {
  const normalized = normalizeWorkspaceInput(input);
  const actor = await db
    .prepare(`SELECT id FROM user WHERE id = ?`)
    .bind(actorUserId)
    .first<{ id: string }>();
  if (!actor) throw error(404, "Account not found");
  const existing = await db
    .prepare(`SELECT 1 AS present FROM workspaces WHERE slug = ?`)
    .bind(normalized.slug)
    .first<{ present: number }>();
  if (existing) throw error(409, "Workspace slug is already in use");
  const sequence = await db
    .prepare(
      `UPDATE telemetry_resource_sequences SET value = value + 1
       WHERE kind = 'workspace' RETURNING value`,
    )
    .first<{ value: number }>();
  if (!sequence) throw error(500, "Workspace sequence is unavailable");
  const workspaceId = crypto.randomUUID();
  const dashboardId = crypto.randomUUID();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO workspaces
          (id, telemetry_pk, slug, name, default_dashboard_id,
           default_sampling_interval_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        workspaceId,
        sequence.value,
        normalized.slug,
        normalized.name,
        dashboardId,
        normalized.defaultSamplingIntervalSeconds,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO memberships
          (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES (?, ?, 'admin', 'active', ?, ?)`,
      )
      .bind(workspaceId, actorUserId, now, now),
    db
      .prepare(
        `INSERT INTO dashboards
          (id, workspace_id, slug, name, description, visibility, created_by, created_at, updated_at)
         VALUES (?, ?, 'overview', 'Overview', '', ?, ?, ?, ?)`,
      )
      .bind(dashboardId, workspaceId, normalized.dashboardVisibility, actorUserId, now, now),
    db
      .prepare(
        `INSERT INTO retention_policies
          (workspace_id, raw_days, rollup_5m_days, rollup_1h_days, event_days, updated_at)
         VALUES (?, ?, 30, 365, 365, ?)`,
      )
      .bind(workspaceId, normalized.rawDays, now),
    await prepareAuditStatement(db, {
      workspaceId,
      actorUserId,
      action: "workspace.create",
      resourceType: "workspace",
      resourceId: workspaceId,
      before: null,
      after: {
        name: normalized.name,
        slug: normalized.slug,
        defaultSamplingIntervalSeconds: normalized.defaultSamplingIntervalSeconds,
        dashboardVisibility: normalized.dashboardVisibility,
        rawDays: normalized.rawDays,
      },
      now,
    }),
  ];
  try {
    await db.batch(statements);
  } catch (cause) {
    const collision = await db
      .prepare(`SELECT 1 AS present FROM workspaces WHERE slug = ?`)
      .bind(normalized.slug)
      .first<{ present: number }>()
      .catch(() => null);
    if (collision) throw error(409, "Workspace slug is already in use");
    throw cause;
  }
  return { id: workspaceId, slug: normalized.slug };
}

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
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE workspaces SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM memberships actor
             WHERE actor.workspace_id = workspaces.id AND actor.user_id = ?
               AND actor.role = 'admin' AND actor.status = 'active'
           )`,
      )
      .bind(now, now, workspace.id, actorUserId),
    await prepareAuditStatement(db, {
      workspaceId: workspace.id,
      actorUserId,
      action: "workspace.delete",
      resourceType: "workspace",
      resourceId: workspace.id,
      before: { name: workspace.name, slug: workspace.slug, deletedAt: null },
      after: { name: workspace.name, slug: workspace.slug, deletedAt: now },
      now,
      onlyIfPreviousStatementChanged: true,
    }),
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Workspace state changed; reload and try again");
  }
}

export async function restoreWorkspace(
  db: D1Database,
  workspaceId: string,
  actorUserId: string,
): Promise<{ slug: string }> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, w.deleted_at, w.purge_started_at,
              m.role, p.soft_delete_grace_days
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
      purge_started_at: number | null;
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
  if (workspace.purge_started_at !== null) {
    throw error(409, "The workspace recovery window has expired");
  }
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE workspaces SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND deleted_at = ? AND purge_started_at IS NULL
           AND EXISTS (
             SELECT 1 FROM memberships actor
             WHERE actor.workspace_id = workspaces.id AND actor.user_id = ?
               AND actor.role = 'admin' AND actor.status = 'active'
           )`,
      )
      .bind(now, workspace.id, workspace.deleted_at, actorUserId),
    await prepareAuditStatement(db, {
      workspaceId: workspace.id,
      actorUserId,
      action: "workspace.restore",
      resourceType: "workspace",
      resourceId: workspace.id,
      before: { name: workspace.name, slug: workspace.slug, deletedAt: workspace.deleted_at },
      after: { name: workspace.name, slug: workspace.slug, deletedAt: null },
      now,
      onlyIfPreviousStatementChanged: true,
    }),
  ]);
  if (updateResult?.meta.changes !== 1) {
    throw error(409, "Workspace state changed; reload and try again");
  }
  return { slug: workspace.slug };
}
