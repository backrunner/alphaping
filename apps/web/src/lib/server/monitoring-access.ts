import {
  canAccessResource,
  type Capability,
  type ResourceGrant,
  type ResourceType,
  type WorkspaceRole,
} from "@alphaping/authz";
import { error } from "@sveltejs/kit";

interface WorkspaceRow {
  id: string;
  telemetry_pk: number;
  default_dashboard_id: string;
  role: WorkspaceRole;
}

interface GrantRow {
  resource_type: ResourceType;
  resource_id: string;
  capability: Capability;
  effect: "allow" | "deny";
}

export interface MonitoringAccess {
  workspaceId: string;
  workspacePk: number;
  defaultDashboardId: string;
  role: WorkspaceRole;
  grants: readonly ResourceGrant[];
}

export interface DeveloperPanelData {
  agents: readonly { id: string; name: string }[];
}

export async function loadMonitoringAccess(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<MonitoringAccess> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.telemetry_pk, w.default_dashboard_id, m.role
     FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
     WHERE w.slug = ? AND w.deleted_at IS NULL AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, userId)
    .first<WorkspaceRow>();
  if (!workspace) throw error(404, "Workspace not found");
  const grants = await db
    .prepare(
      `SELECT resource_type, resource_id, capability, effect FROM resource_grants
     WHERE workspace_id = ? AND subject_user_id = ?`,
    )
    .bind(workspace.id, userId)
    .all<GrantRow>();
  return {
    workspaceId: workspace.id,
    workspacePk: workspace.telemetry_pk,
    defaultDashboardId: workspace.default_dashboard_id,
    role: workspace.role,
    grants: grants.results.map((grant) => ({
      resourceType: grant.resource_type,
      resourceId: grant.resource_id,
      capability: grant.capability,
      effect: grant.effect,
    })),
  };
}

export function requireAdmin(access: MonitoringAccess): void {
  if (access.role !== "admin") throw error(404, "Workspace not found");
}

export function requireResourceCapability(
  access: MonitoringAccess,
  resourceType: ResourceType,
  resourceId: string,
  capability: Capability,
): void {
  if (!canAccessResource(access.role, access.grants, resourceType, resourceId, capability)) {
    throw error(404, "Resource not found");
  }
}

export async function loadDeveloperPanel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<DeveloperPanelData> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const agents = await db
    .prepare(
      `SELECT a.id, m.name AS machine_name FROM agents a
       JOIN machines m ON m.id = a.machine_id
       WHERE a.workspace_id = ? AND a.status = 'active' AND m.deleted_at IS NULL
       ORDER BY m.name LIMIT 200`,
    )
    .bind(access.workspaceId)
    .all<{ id: string; machine_name: string }>();
  return {
    agents: agents.results.map((agent) => ({ id: agent.id, name: agent.machine_name })),
  };
}
