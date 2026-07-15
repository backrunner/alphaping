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
  if (
    relevant.some((grant) => grant.effect === "deny" && grant.capability === capability) ||
    (capability === "view" &&
      relevant.some((grant) => grant.effect === "deny" && grant.capability === "view"))
  ) {
    return false;
  }
  return relevant.some(
    (grant) =>
      grant.effect === "allow" &&
      (grant.capability === capability || (capability === "view" && grant.capability === "manage")),
  );
}
