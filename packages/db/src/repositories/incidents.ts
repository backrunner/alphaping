import {
  canAccessIncident,
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

interface ServiceRow {
  id: string;
  name: string;
}

interface IncidentRow {
  id: string;
  title: string;
  summary: string;
  severity: "minor" | "major" | "critical";
  state: "investigating" | "identified" | "monitoring" | "resolved";
  starts_at: number;
  resolved_at: number | null;
  created_at: number;
}

interface IncidentResourceRow {
  incident_id: string;
  resource_id: string;
  impact: "degraded" | "down";
}

interface IncidentUpdateRow {
  id: string;
  incident_id: string;
  state: string;
  body: string;
  published_at: number | null;
  created_at: number;
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  severity: "info" | "maintenance" | "minor" | "major" | "critical";
  starts_at: number;
  expires_at: number;
  visibility: "private" | "authenticated" | "public";
}

export interface IncidentCenter {
  workspace: { id: string; name: string; slug: string; role: WorkspaceRole };
  services: readonly { id: string; name: string; canManage: boolean }[];
  incidents: readonly {
    id: string;
    title: string;
    summary: string;
    severity: IncidentRow["severity"];
    state: IncidentRow["state"];
    startsAt: number;
    resolvedAt: number | null;
    affectedServices: readonly { id: string; name: string; impact: "degraded" | "down" }[];
    updates: readonly { id: string; state: string; body: string; publishedAt: number }[];
    canManage: boolean;
  }[];
  announcements: readonly {
    id: string;
    title: string;
    body: string;
    severity: AnnouncementRow["severity"];
    startsAt: number;
    expiresAt: number;
    visibility: AnnouncementRow["visibility"];
  }[];
  canCreateIncident: boolean;
  canManageAnnouncements: boolean;
}

export class IncidentCenterNotFoundError extends Error {}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

export async function loadIncidentCenter(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  now = Date.now(),
): Promise<IncidentCenter> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, m.role
     FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
     WHERE w.slug = ? AND w.deleted_at IS NULL AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, userId)
    .first<WorkspaceRow>();
  if (!workspace) throw new IncidentCenterNotFoundError();
  const grantsResult = await db
    .prepare(
      `SELECT resource_type, resource_id, capability, effect FROM resource_grants
     WHERE workspace_id = ? AND subject_user_id = ?
       AND resource_type IN ('service', 'incident')`,
    )
    .bind(workspace.id, userId)
    .all<GrantRow>();
  const grants: readonly ResourceGrant[] = grantsResult.results.map((grant) => ({
    resourceType: grant.resource_type,
    resourceId: grant.resource_id,
    capability: grant.capability,
    effect: grant.effect,
  }));
  const serviceRows = (
    await db
      .prepare(
        `SELECT id, name FROM services WHERE workspace_id = ? AND deleted_at IS NULL
     ORDER BY name LIMIT 200`,
      )
      .bind(workspace.id)
      .all<ServiceRow>()
  ).results;
  const services = serviceRows
    .filter((service) => canAccessResource(workspace.role, grants, "service", service.id, "view"))
    .map((service) => ({
      ...service,
      canManage: canAccessResource(workspace.role, grants, "service", service.id, "manage"),
    }));
  const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
  const incidents = (
    await db
      .prepare(
        `SELECT id, title, summary, severity, state, starts_at, resolved_at, created_at
     FROM incidents WHERE workspace_id = ? AND deleted_at IS NULL
     ORDER BY starts_at DESC LIMIT 100`,
      )
      .bind(workspace.id)
      .all<IncidentRow>()
  ).results;
  const incidentIds = incidents.map((incident) => incident.id);
  const [resources, updates] =
    incidentIds.length === 0
      ? [{ results: [] as IncidentResourceRow[] }, { results: [] as IncidentUpdateRow[] }]
      : await Promise.all([
          db
            .prepare(
              `SELECT incident_id, resource_id, impact FROM incident_resources
           WHERE resource_type = 'service' AND incident_id IN (${placeholders(incidentIds.length)})`,
            )
            .bind(...incidentIds)
            .all<IncidentResourceRow>(),
          db
            .prepare(
              `SELECT id, incident_id, state, body, published_at, created_at
           FROM incident_updates WHERE incident_id IN (${placeholders(incidentIds.length)})
           ORDER BY COALESCE(published_at, created_at) DESC LIMIT 500`,
            )
            .bind(...incidentIds)
            .all<IncidentUpdateRow>(),
        ]);
  const visibleIncidents = incidents.flatMap((incident) => {
    const incidentResources = resources.results.filter(
      (resource) => resource.incident_id === incident.id,
    );
    const visibleResources = incidentResources.filter((resource) =>
      serviceNameById.has(resource.resource_id),
    );
    const canViewIncident = canAccessIncident(
      workspace.role,
      grants,
      incident.id,
      "view",
      visibleResources.length > 0,
    );
    if (!canViewIncident) return [];
    const canManage = canAccessIncident(
      workspace.role,
      grants,
      incident.id,
      "manage",
      incidentResources.length > 0 &&
        incidentResources.every((resource) =>
          canAccessResource(workspace.role, grants, "service", resource.resource_id, "manage"),
        ),
    );
    return [
      {
        id: incident.id,
        title: incident.title,
        summary: incident.summary,
        severity: incident.severity,
        state: incident.state,
        startsAt: incident.starts_at,
        resolvedAt: incident.resolved_at,
        affectedServices: visibleResources.map((resource) => ({
          id: resource.resource_id,
          name: serviceNameById.get(resource.resource_id) ?? "Service",
          impact: resource.impact,
        })),
        updates: updates.results
          .filter((update) => update.incident_id === incident.id)
          .map((update) => ({
            id: update.id,
            state: update.state,
            body: update.body,
            publishedAt: update.published_at ?? update.created_at,
          })),
        canManage,
      },
    ];
  });
  const announcements = (
    await db
      .prepare(
        `SELECT id, title, body, severity, starts_at, expires_at, visibility
     FROM announcements WHERE workspace_id = ? AND deleted_at IS NULL
       AND expires_at > ? AND (visibility != 'private' OR ? = 'admin')
     ORDER BY starts_at DESC LIMIT 100`,
      )
      .bind(workspace.id, now, workspace.role)
      .all<AnnouncementRow>()
  ).results;
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: workspace.role,
    },
    services,
    incidents: visibleIncidents,
    announcements: announcements.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      severity: announcement.severity,
      startsAt: announcement.starts_at,
      expiresAt: announcement.expires_at,
      visibility: announcement.visibility,
    })),
    canCreateIncident: workspace.role === "admin" || services.some((service) => service.canManage),
    canManageAnnouncements: workspace.role === "admin",
  };
}
