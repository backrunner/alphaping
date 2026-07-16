import {
  canAccessResource,
  type ResourceGrant,
  type ResourceType,
  type WorkspaceRole,
} from "@alphaping/authz";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

interface GrantRow {
  resource_type: ResourceType;
  resource_id: string;
  capability: "view" | "manage";
  effect: "allow" | "deny";
}

interface ResourceRow {
  resource_type: "machine" | "service";
  resource_id: string;
}

export interface WorkspaceShellNavigation {
  machines: boolean;
  services: boolean;
  developer: boolean;
}

export interface WorkspaceShellData {
  workspace: WorkspaceRow;
  navigation: WorkspaceShellNavigation;
}

export class WorkspaceShellNotFoundError extends Error {}

export function computeWorkspaceShellNavigation(
  role: WorkspaceRole,
  grants: readonly ResourceGrant[],
  resources: readonly ResourceRow[],
): WorkspaceShellNavigation {
  const canView = (resource: ResourceRow) =>
    canAccessResource(role, grants, resource.resource_type, resource.resource_id, "view");
  return {
    machines: resources.some(
      (resource) => resource.resource_type === "machine" && canView(resource),
    ),
    services: resources.some(
      (resource) => resource.resource_type === "service" && canView(resource),
    ),
    developer: role === "admin",
  };
}

export async function loadWorkspaceShell(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<WorkspaceShellData> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, m.role
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE w.slug = ? AND w.deleted_at IS NULL AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, userId)
    .first<WorkspaceRow>();
  if (!workspace) throw new WorkspaceShellNotFoundError();

  const [grantRows, resourceRows] = await Promise.all([
    db
      .prepare(
        `SELECT resource_type, resource_id, capability, effect FROM resource_grants
         WHERE workspace_id = ? AND subject_user_id = ?
           AND resource_type IN ('machine', 'service')`,
      )
      .bind(workspace.id, userId)
      .all<GrantRow>(),
    db
      .prepare(
        `SELECT 'machine' AS resource_type, id AS resource_id FROM machines
         WHERE workspace_id = ? AND deleted_at IS NULL
         UNION ALL
         SELECT 'service' AS resource_type, id AS resource_id FROM services
         WHERE workspace_id = ? AND deleted_at IS NULL`,
      )
      .bind(workspace.id, workspace.id)
      .all<ResourceRow>(),
  ]);
  const grants = grantRows.results.map<ResourceGrant>((grant) => ({
    resourceType: grant.resource_type,
    resourceId: grant.resource_id,
    capability: grant.capability,
    effect: grant.effect,
  }));
  return {
    workspace,
    navigation: computeWorkspaceShellNavigation(workspace.role, grants, resourceRows.results),
  };
}
