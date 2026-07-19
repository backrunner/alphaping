import type { Capability, ResourceType, WorkspaceRole } from "@alphaping/authz";

export interface ResourceQueryAccess {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export interface QueryCondition {
  sql: string;
  binds: readonly unknown[];
}

function activeRoleCondition(access: ResourceQueryAccess): QueryCondition {
  return {
    sql: `EXISTS (
      SELECT 1 FROM memberships actor
      WHERE actor.workspace_id = ? AND actor.user_id = ?
        AND actor.role = ? AND actor.status = 'active'
    )`,
    binds: [access.workspaceId, access.userId, access.role],
  };
}

function grantAllowCondition(
  access: ResourceQueryAccess,
  resourceType: ResourceType,
  resourceIdExpression: string,
  capability: Capability,
): QueryCondition {
  const allowedCapabilities = capability === "manage" ? "'manage'" : "'view', 'manage'";
  return {
    sql: `EXISTS (
      SELECT 1 FROM resource_grants allowed
      WHERE allowed.workspace_id = ? AND allowed.subject_user_id = ?
        AND allowed.resource_type = ? AND allowed.resource_id = ${resourceIdExpression}
        AND allowed.capability IN (${allowedCapabilities}) AND allowed.effect = 'allow'
    )`,
    binds: [access.workspaceId, access.userId, resourceType],
  };
}

function grantDenyCondition(
  access: ResourceQueryAccess,
  resourceType: ResourceType,
  resourceIdExpression: string,
  capability: Capability,
): QueryCondition {
  const deniedCapabilities = capability === "manage" ? "'view', 'manage'" : "'view'";
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM resource_grants denied
      WHERE denied.workspace_id = ? AND denied.subject_user_id = ?
        AND denied.resource_type = ? AND denied.resource_id = ${resourceIdExpression}
        AND denied.capability IN (${deniedCapabilities}) AND denied.effect = 'deny'
    )`,
    binds: [access.workspaceId, access.userId, resourceType],
  };
}

export function resourceCapabilityCondition(
  access: ResourceQueryAccess,
  resourceType: ResourceType,
  resourceIdExpression: string,
  capability: Capability,
): QueryCondition {
  const activeRole = activeRoleCondition(access);
  if (access.role === "admin") return activeRole;
  const allow = grantAllowCondition(access, resourceType, resourceIdExpression, capability);
  const deny = grantDenyCondition(access, resourceType, resourceIdExpression, capability);
  return {
    sql: `(${activeRole.sql}) AND (${allow.sql}) AND (${deny.sql})`,
    binds: [...activeRole.binds, ...allow.binds, ...deny.binds],
  };
}

export function incidentViewCondition(
  access: ResourceQueryAccess,
  incidentIdExpression: string,
): QueryCondition {
  const activeRole = activeRoleCondition(access);
  if (access.role === "admin") return activeRole;

  const directAllow = grantAllowCondition(access, "incident", incidentIdExpression, "view");
  const directDeny = grantDenyCondition(access, "incident", incidentIdExpression, "view");
  const inheritedAllow = grantAllowCondition(access, "service", "affected.resource_id", "view");
  const inheritedDeny = grantDenyCondition(access, "service", "affected.resource_id", "view");
  return {
    sql: `(${activeRole.sql})
      AND (${directDeny.sql})
      AND (
        (${directAllow.sql})
        OR EXISTS (
          SELECT 1 FROM incident_resources affected
          JOIN services inherited
            ON inherited.id = affected.resource_id
              AND inherited.workspace_id = ? AND inherited.deleted_at IS NULL
          WHERE affected.incident_id = ${incidentIdExpression}
            AND affected.resource_type = 'service'
            AND (${inheritedAllow.sql}) AND (${inheritedDeny.sql})
        )
      )`,
    binds: [
      ...activeRole.binds,
      ...directDeny.binds,
      ...directAllow.binds,
      access.workspaceId,
      ...inheritedAllow.binds,
      ...inheritedDeny.binds,
    ],
  };
}

export function incidentManageCondition(
  access: ResourceQueryAccess,
  incidentIdExpression: string,
): QueryCondition {
  const activeRole = activeRoleCondition(access);
  if (access.role === "admin") return activeRole;

  const directAllow = grantAllowCondition(access, "incident", incidentIdExpression, "manage");
  const directDeny = grantDenyCondition(access, "incident", incidentIdExpression, "manage");
  const inheritedAllow = grantAllowCondition(
    access,
    "service",
    "blocked_affected.resource_id",
    "manage",
  );
  const inheritedDeny = grantDenyCondition(
    access,
    "service",
    "blocked_affected.resource_id",
    "manage",
  );
  return {
    sql: `(${activeRole.sql})
      AND (${directDeny.sql})
      AND (
        (${directAllow.sql})
        OR (
          EXISTS (
            SELECT 1 FROM incident_resources affected
            WHERE affected.incident_id = ${incidentIdExpression}
              AND affected.resource_type = 'service'
          )
          AND NOT EXISTS (
            SELECT 1 FROM incident_resources blocked_affected
            WHERE blocked_affected.incident_id = ${incidentIdExpression}
              AND blocked_affected.resource_type = 'service'
              AND NOT ((${inheritedAllow.sql}) AND (${inheritedDeny.sql}))
          )
        )
      )`,
    binds: [
      ...activeRole.binds,
      ...directDeny.binds,
      ...directAllow.binds,
      ...inheritedAllow.binds,
      ...inheritedDeny.binds,
    ],
  };
}
