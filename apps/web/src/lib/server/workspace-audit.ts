import { error } from "@sveltejs/kit";

import { requireWorkspaceAdmin } from "./workspace-admin.js";

const PAGE_SIZE = 50;
const MAX_PAGE = 100;

interface AuditRow {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before_digest: string | null;
  after_digest: string | null;
  created_at: number;
  actor_name: string | null;
  actor_email: string | null;
}

export interface WorkspaceAuditPage {
  entries: readonly {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string;
    beforeDigest: string | null;
    afterDigest: string | null;
    createdAt: number;
    actorName: string;
    actorEmail: string | null;
  }[];
  page: number;
  pages: number;
  total: number;
}

export async function loadWorkspaceAuditPage(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  requestedPage: number,
): Promise<WorkspaceAuditPage> {
  const page = Number.isInteger(requestedPage) ? Math.min(MAX_PAGE, Math.max(1, requestedPage)) : 1;
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const count = await db
    .prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE workspace_id = ?`)
    .bind(access.workspaceId)
    .first<{ count: number }>();
  if (!count) throw error(500, "Audit log count is unavailable");
  const pages = Math.max(1, Math.min(MAX_PAGE, Math.ceil(count.count / PAGE_SIZE)));
  const selectedPage = Math.min(page, pages);
  const rows = await db
    .prepare(
      `SELECT a.id, a.action, a.resource_type, a.resource_id,
              a.before_digest, a.after_digest, a.created_at,
              u.name AS actor_name, u.email AS actor_email
       FROM audit_logs a LEFT JOIN user u ON u.id = a.actor_user_id
       WHERE a.workspace_id = ?
       ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(access.workspaceId, PAGE_SIZE, (selectedPage - 1) * PAGE_SIZE)
    .all<AuditRow>();
  return {
    entries: rows.results.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      beforeDigest: row.before_digest,
      afterDigest: row.after_digest,
      createdAt: row.created_at,
      actorName: row.actor_name ?? "Deleted user",
      actorEmail: row.actor_email,
    })),
    page: selectedPage,
    pages,
    total: count.count,
  };
}
