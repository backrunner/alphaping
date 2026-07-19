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
  default_sampling_interval_seconds: number;
  role: WorkspaceRole;
}

interface GrantRow {
  resource_type: ResourceType;
  resource_id: string;
  capability: Capability;
  effect: "allow" | "deny";
}

const MAX_ACCESS_GRANTS = 5_000;
const AGENT_PAGE_SIZE = 50;
const AGENT_MAX_PAGE = 100;

export interface MonitoringAccess {
  workspaceId: string;
  workspacePk: number;
  defaultDashboardId: string;
  defaultSamplingIntervalSeconds: number;
  role: WorkspaceRole;
  grants: readonly ResourceGrant[];
}

export interface DeveloperPanelData {
  agents: readonly { id: string; name: string }[];
  agentPagination: { page: number; hasPrevious: boolean; hasNext: boolean };
  defaultSamplingIntervalSeconds: number;
}

function requestedAgentPage(value: number | undefined): number {
  if (!Number.isSafeInteger(value)) return 1;
  return Math.min(AGENT_MAX_PAGE, Math.max(1, value ?? 1));
}

export async function loadMonitoringAccess(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<MonitoringAccess> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.telemetry_pk, w.default_dashboard_id,
            w.default_sampling_interval_seconds, m.role
     FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
     WHERE w.slug = ? AND w.deleted_at IS NULL AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, userId)
    .first<WorkspaceRow>();
  if (!workspace) throw error(404, "Workspace not found");
  if (workspace.role === "admin") {
    return {
      workspaceId: workspace.id,
      workspacePk: workspace.telemetry_pk,
      defaultDashboardId: workspace.default_dashboard_id,
      defaultSamplingIntervalSeconds: workspace.default_sampling_interval_seconds,
      role: workspace.role,
      grants: [],
    };
  }
  const grants = await db
    .prepare(
      `SELECT resource_type, resource_id, capability, effect FROM resource_grants
       WHERE workspace_id = ? AND subject_user_id = ?
       ORDER BY resource_type, resource_id, capability, effect LIMIT ?`,
    )
    .bind(workspace.id, userId, MAX_ACCESS_GRANTS + 1)
    .all<GrantRow>();
  if (grants.results.length > MAX_ACCESS_GRANTS) {
    throw error(503, "Resource access scope exceeds the supported limit");
  }
  return {
    workspaceId: workspace.id,
    workspacePk: workspace.telemetry_pk,
    defaultDashboardId: workspace.default_dashboard_id,
    defaultSamplingIntervalSeconds: workspace.default_sampling_interval_seconds,
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

export interface FinalAuthorizationCondition {
  sql: string;
  binds: readonly unknown[];
}

export function combineFinalAuthorizationConditions(
  ...conditions: readonly FinalAuthorizationCondition[]
): FinalAuthorizationCondition {
  return {
    sql: conditions.map((condition) => `(${condition.sql})`).join(" AND "),
    binds: conditions.flatMap((condition) => condition.binds),
  };
}

/**
 * Re-check the actor inside the mutation statement. The access object is a
 * snapshot, so a membership or grant change can happen after the initial
 * authorization read and before the write batch executes.
 */
export function finalResourceCapabilityCondition(
  access: MonitoringAccess,
  actorUserId: string,
  resourceType: ResourceType,
  workspaceExpression: string,
  resourceIdExpression: string,
  capability: Capability,
  resourceIdBinds: readonly unknown[] = [],
  workspaceBinds: readonly unknown[] = [],
): FinalAuthorizationCondition {
  if (access.role !== "member") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM memberships actor
        WHERE actor.workspace_id = ${workspaceExpression}
          AND actor.user_id = ? AND actor.role = 'admin' AND actor.status = 'active'
      )`,
      binds: [...workspaceBinds, actorUserId],
    };
  }
  const allowedCapabilities = capability === "manage" ? "'manage'" : "'view', 'manage'";
  const deniedCapabilities = capability === "manage" ? "'view', 'manage'" : "'view'";
  return {
    sql: `EXISTS (
      SELECT 1 FROM memberships actor
      WHERE actor.workspace_id = ${workspaceExpression}
        AND actor.user_id = ? AND actor.role = 'member' AND actor.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM resource_grants allowed
      WHERE allowed.workspace_id = ${workspaceExpression}
        AND allowed.subject_user_id = ?
        AND allowed.resource_type = ?
        AND allowed.resource_id = ${resourceIdExpression}
        AND allowed.capability IN (${allowedCapabilities})
        AND allowed.effect = 'allow'
    )
    AND NOT EXISTS (
      SELECT 1 FROM resource_grants denied
      WHERE denied.workspace_id = ${workspaceExpression}
        AND denied.subject_user_id = ?
        AND denied.resource_type = ?
        AND denied.resource_id = ${resourceIdExpression}
        AND denied.capability IN (${deniedCapabilities})
        AND denied.effect = 'deny'
    )`,
    binds: [
      ...workspaceBinds,
      actorUserId,
      ...workspaceBinds,
      actorUserId,
      resourceType,
      ...resourceIdBinds,
      ...workspaceBinds,
      actorUserId,
      resourceType,
      ...resourceIdBinds,
    ],
  };
}

export function finalAdminCondition(
  actorUserId: string,
  workspaceExpression: string,
): FinalAuthorizationCondition {
  return {
    sql: `EXISTS (
      SELECT 1 FROM memberships actor
      WHERE actor.workspace_id = ${workspaceExpression}
        AND actor.user_id = ? AND actor.role = 'admin' AND actor.status = 'active'
    )`,
    binds: [actorUserId],
  };
}

export async function loadDeveloperPanel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  request: { agentPage?: number } = {},
): Promise<DeveloperPanelData> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const page = requestedAgentPage(request.agentPage);
  const agents = await db
    .prepare(
      `SELECT a.id, m.name AS machine_name FROM agents a
       JOIN machines m ON m.id = a.machine_id
       WHERE a.workspace_id = ? AND a.status = 'active' AND m.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM memberships actor
           WHERE actor.workspace_id = a.workspace_id AND actor.user_id = ?
             AND actor.role = 'admin' AND actor.status = 'active'
         )
       ORDER BY m.name, a.id LIMIT ? OFFSET ?`,
    )
    .bind(access.workspaceId, userId, AGENT_PAGE_SIZE + 1, (page - 1) * AGENT_PAGE_SIZE)
    .all<{ id: string; machine_name: string }>();
  return {
    agents: agents.results
      .slice(0, AGENT_PAGE_SIZE)
      .map((agent) => ({ id: agent.id, name: agent.machine_name })),
    agentPagination: {
      page,
      hasPrevious: page > 1,
      hasNext: agents.results.length > AGENT_PAGE_SIZE,
    },
    defaultSamplingIntervalSeconds: access.defaultSamplingIntervalSeconds,
  };
}
