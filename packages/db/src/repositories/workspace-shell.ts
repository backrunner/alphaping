import { canAccessResource, type ResourceGrant, type WorkspaceRole } from "@alphaping/authz";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

interface ResourceRow {
  resource_type: "machine" | "service";
  resource_id: string;
}

interface NavigationRow {
  machines: number;
  services: number;
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

  const visibleResourceExists = (table: "machines" | "services", resourceType: string) =>
    workspace.role === "admin"
      ? `EXISTS (
          SELECT 1 FROM ${table} resource
          WHERE resource.workspace_id = ? AND resource.deleted_at IS NULL
        )`
      : `EXISTS (
          SELECT 1 FROM resource_grants allowed
          JOIN ${table} resource
            ON resource.id = allowed.resource_id AND resource.workspace_id = allowed.workspace_id
              AND resource.deleted_at IS NULL
          WHERE allowed.workspace_id = ? AND allowed.subject_user_id = ?
            AND allowed.resource_type = '${resourceType}'
            AND allowed.capability IN ('view', 'manage') AND allowed.effect = 'allow'
            AND NOT EXISTS (
              SELECT 1 FROM resource_grants denied
              WHERE denied.workspace_id = allowed.workspace_id
                AND denied.subject_user_id = allowed.subject_user_id
                AND denied.resource_type = allowed.resource_type
                AND denied.resource_id = allowed.resource_id
                AND denied.capability = 'view' AND denied.effect = 'deny'
            )
        )`;
  const navigationBindings =
    workspace.role === "admin"
      ? [workspace.id, workspace.id]
      : [workspace.id, userId, workspace.id, userId];
  const navigation = await db
    .prepare(
      `SELECT
         ${visibleResourceExists("machines", "machine")} AS machines,
         ${visibleResourceExists("services", "service")} AS services`,
    )
    .bind(...navigationBindings)
    .first<NavigationRow>();
  if (!navigation) throw new WorkspaceShellNotFoundError();
  return {
    workspace,
    navigation: {
      machines: navigation.machines === 1,
      services: navigation.services === 1,
      developer: workspace.role === "admin",
    },
  };
}
