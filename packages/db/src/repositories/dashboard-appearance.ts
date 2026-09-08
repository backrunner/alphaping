import type { SiteAppearance } from "@alphaping/contracts";

export function loadDashboardAppearance(db: D1Database, workspaceId: string, dashboardId: string) {
  return db
    .prepare(
      `SELECT appearance_json FROM dashboards
     WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(dashboardId, workspaceId)
    .first<{ appearance_json: string }>();
}

export function prepareDashboardAppearanceUpdate(
  db: D1Database,
  input: {
    workspaceId: string;
    dashboardId: string;
    actorUserId: string;
    previousJson: string;
    appearance: SiteAppearance;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE dashboards SET appearance_json = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND appearance_json = ? AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
         WHERE w.id = dashboards.workspace_id AND w.deleted_at IS NULL
           AND m.user_id = ? AND m.role = 'admin' AND m.status = 'active')`,
    )
    .bind(
      JSON.stringify(input.appearance),
      input.now,
      input.dashboardId,
      input.workspaceId,
      input.previousJson,
      input.actorUserId,
    );
}
