export type WorkspaceRole = "admin" | "member";
export type Capability = "view" | "manage";
export type GrantEffect = "allow" | "deny";
export type ResourceType = "machine" | "service" | "container" | "dashboard" | "incident";

export interface ResourceGrant {
  resourceType: ResourceType;
  resourceId: string;
  capability: Capability;
  effect: GrantEffect;
}

function deniesCapability(grant: ResourceGrant, capability: Capability): boolean {
  return (
    grant.effect === "deny" &&
    (grant.capability === capability || (capability === "manage" && grant.capability === "view"))
  );
}

export function canAccessResource(
  role: WorkspaceRole,
  grants: readonly ResourceGrant[],
  resourceType: ResourceType,
  resourceId: string,
  capability: Capability,
): boolean {
  if (role === "admin") return true;
  const relevant = grants.filter(
    (grant) => grant.resourceType === resourceType && grant.resourceId === resourceId,
  );
  if (relevant.some((grant) => deniesCapability(grant, capability))) {
    return false;
  }
  return relevant.some(
    (grant) =>
      grant.effect === "allow" &&
      (grant.capability === capability || (capability === "view" && grant.capability === "manage")),
  );
}

export function canAccessIncident(
  role: WorkspaceRole,
  grants: readonly ResourceGrant[],
  incidentId: string,
  capability: Capability,
  inheritedFromServices: boolean,
): boolean {
  if (role === "admin") return true;
  const incidentGrants = grants.filter(
    (grant) => grant.resourceType === "incident" && grant.resourceId === incidentId,
  );
  if (incidentGrants.some((grant) => deniesCapability(grant, capability))) return false;
  return (
    canAccessResource(role, incidentGrants, "incident", incidentId, capability) ||
    inheritedFromServices
  );
}

export function canAccessContainer(
  role: WorkspaceRole,
  grants: readonly ResourceGrant[],
  machineId: string,
  containerId: string,
  capability: Capability,
): boolean {
  if (role === "admin") return true;
  const containerGrants = grants.filter(
    (grant) => grant.resourceType === "container" && grant.resourceId === containerId,
  );
  const denied = containerGrants.some((grant) => deniesCapability(grant, capability));
  if (denied) return false;
  const allowed = containerGrants.some(
    (grant) =>
      grant.effect === "allow" &&
      (grant.capability === capability || (capability === "view" && grant.capability === "manage")),
  );
  return allowed || canAccessResource(role, grants, "machine", machineId, capability);
}
