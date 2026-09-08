import { error } from "@sveltejs/kit";
import { parseSiteAppearance, validateSiteAppearance } from "@alphaping/contracts";
import { loadDashboardAppearance, prepareDashboardAppearanceUpdate } from "@alphaping/db";
import { prepareAuditStatement, requireWorkspaceAdmin } from "./workspace-admin.js";

export async function loadSiteAppearance(db: D1Database, slug: string, userId: string) {
  const access = await requireWorkspaceAdmin(db, slug, userId);
  const row = await loadDashboardAppearance(db, access.workspaceId, access.defaultDashboardId);
  if (!row) throw error(404, "Dashboard not found");
  return parseSiteAppearance(row.appearance_json);
}

export async function updateSiteAppearance(
  db: D1Database,
  slug: string,
  userId: string,
  value: unknown,
) {
  const access = await requireWorkspaceAdmin(db, slug, userId);
  let appearance;
  try {
    appearance = validateSiteAppearance(value);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : "Appearance settings are invalid");
  }
  const current = await loadDashboardAppearance(db, access.workspaceId, access.defaultDashboardId);
  if (!current) throw error(404, "Dashboard not found");
  const now = Date.now();
  const results = await db.batch([
    prepareDashboardAppearanceUpdate(db, {
      workspaceId: access.workspaceId,
      dashboardId: access.defaultDashboardId,
      actorUserId: userId,
      previousJson: current.appearance_json,
      appearance,
      now,
    }),
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId: userId,
      action: "dashboard.appearance.update",
      resourceType: "dashboard",
      resourceId: access.defaultDashboardId,
      before: parseSiteAppearance(current.appearance_json),
      after: appearance,
      now,
      onlyIfPreviousStatementChanged: true,
    }),
  ]);
  if (results[0]?.meta.changes !== 1)
    throw error(409, "Settings or access changed. Reload and try again.");
  return appearance;
}
