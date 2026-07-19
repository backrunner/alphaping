import type { WorkspaceRole } from "@alphaping/authz";

import { queryInBatches } from "./d1-query-batches.js";
import { loadLatestIncidentUpdates } from "./incident-updates.js";
import {
  incidentManageCondition,
  incidentViewCondition,
  resourceCapabilityCondition,
} from "./resource-access-query.js";

const INCIDENT_UPDATES_PER_INCIDENT_LIMIT = 50;
const INCIDENT_UPDATES_GLOBAL_LIMIT = 500;

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

interface ServiceRow {
  id: string;
  name: string;
  can_manage: number;
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
  can_manage: number;
}

interface IncidentResourceRow {
  incident_id: string;
  resource_id: string;
  impact: "degraded" | "down";
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
  const access = { workspaceId: workspace.id, userId, role: workspace.role };
  const serviceAuthorization = resourceCapabilityCondition(access, "service", "service.id", "view");
  const serviceManagement = resourceCapabilityCondition(access, "service", "service.id", "manage");
  const serviceRows = (
    await db
      .prepare(
        `SELECT id, name,
                CASE WHEN (${serviceManagement.sql}) THEN 1 ELSE 0 END AS can_manage
         FROM services service
         WHERE workspace_id = ? AND deleted_at IS NULL
           AND (${serviceAuthorization.sql})
         ORDER BY name LIMIT 200`,
      )
      .bind(...serviceManagement.binds, workspace.id, ...serviceAuthorization.binds)
      .all<ServiceRow>()
  ).results;
  const services = serviceRows.map((service) => ({
    id: service.id,
    name: service.name,
    canManage: service.can_manage === 1,
  }));
  const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
  const incidentAuthorization = incidentViewCondition(access, "incident.id");
  const incidentManagement = incidentManageCondition(access, "incident.id");
  const incidents = (
    await db
      .prepare(
        `SELECT id, title, summary, severity, state, starts_at, resolved_at, created_at,
                CASE WHEN (${incidentManagement.sql}) THEN 1 ELSE 0 END AS can_manage
         FROM incidents incident WHERE workspace_id = ? AND deleted_at IS NULL
           AND (${incidentAuthorization.sql})
         ORDER BY starts_at DESC LIMIT 100`,
      )
      .bind(...incidentManagement.binds, workspace.id, ...incidentAuthorization.binds)
      .all<IncidentRow>()
  ).results;
  const incidentIds = incidents.map((incident) => incident.id);
  const [resources, updates] = await Promise.all([
    queryInBatches<IncidentResourceRow, string>(db, incidentIds, (batch) =>
      db
        .prepare(
          `SELECT incident_id, resource_id, impact FROM incident_resources
           WHERE resource_type = 'service' AND incident_id IN (${placeholders(batch.length)})`,
        )
        .bind(...batch),
    ),
    loadLatestIncidentUpdates(
      db,
      incidentIds,
      INCIDENT_UPDATES_PER_INCIDENT_LIMIT,
      INCIDENT_UPDATES_GLOBAL_LIMIT,
    ),
  ]);
  const visibleIncidents = incidents.map((incident) => {
    const incidentResources = resources.filter((resource) => resource.incident_id === incident.id);
    const visibleResources = incidentResources.filter((resource) =>
      serviceNameById.has(resource.resource_id),
    );
    return {
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
      updates: updates
        .filter((update) => update.incident_id === incident.id)
        .map((update) => ({
          id: update.id,
          state: update.state,
          body: update.body,
          publishedAt: update.published_at ?? update.created_at,
        })),
      canManage: incident.can_manage === 1,
    };
  });
  const announcements = (
    await db
      .prepare(
        `SELECT id, title, body, severity, starts_at, expires_at, visibility
     FROM announcements WHERE workspace_id = ? AND deleted_at IS NULL
       AND expires_at > ? AND (starts_at <= ? OR ? = 'admin')
       AND (visibility != 'private' OR ? = 'admin')
     ORDER BY starts_at DESC LIMIT 100`,
      )
      .bind(workspace.id, now, now, workspace.role, workspace.role)
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
