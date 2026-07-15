import {
  projectPublicStatusService,
  type PublicServiceLatestRow,
  type PublicServiceRow,
  type PublicStatusBucketRow,
  type PublicStatusService,
} from "./public-status-projection.js";

export { projectPublicStatusService } from "./public-status-projection.js";
export type { PublicStatusService } from "./public-status-projection.js";

interface PublicWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  telemetry_pk: number;
  dashboard_id: string;
  dashboard_name: string;
}

interface CheckIdentityRow {
  telemetry_pk: number;
  service_id: string;
}

interface CheckLatestRow {
  check_pk: number;
  observed_at: number;
}

interface IncidentRow {
  id: string;
  title: string;
  summary: string;
  severity: "minor" | "major" | "critical";
  state: "investigating" | "identified" | "monitoring" | "resolved";
  starts_at: number;
  resolved_at: number | null;
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
}

export interface PublicStatusPage {
  workspace: { name: string; slug: string };
  dashboard: { name: string };
  services: readonly PublicStatusService[];
  incidents: readonly {
    id: string;
    title: string;
    summary: string;
    severity: IncidentRow["severity"];
    state: IncidentRow["state"];
    startsAt: number;
    resolvedAt: number | null;
    affectedServices: readonly { name: string; impact: "degraded" | "down" }[];
    updates: readonly { id: string; state: string; body: string; publishedAt: number }[];
  }[];
  announcements: readonly {
    id: string;
    title: string;
    body: string;
    severity: AnnouncementRow["severity"];
    startsAt: number;
    expiresAt: number;
  }[];
  updatedAt: number | null;
}

export class PublicStatusNotFoundError extends Error {}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

export async function loadPublicStatusPage(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  now = Date.now(),
): Promise<PublicStatusPage> {
  const workspace = await controlDb
    .prepare(
      `SELECT w.id, w.name, w.slug, w.telemetry_pk, d.id AS dashboard_id,
            d.name AS dashboard_name
     FROM workspaces w JOIN dashboards d ON d.id = w.default_dashboard_id
     WHERE w.slug = ? AND w.deleted_at IS NULL AND d.deleted_at IS NULL
       AND d.visibility = 'public'`,
    )
    .bind(workspaceSlug)
    .first<PublicWorkspaceRow>();
  if (!workspace) throw new PublicStatusNotFoundError();
  const services = (
    await controlDb
      .prepare(
        `SELECT s.id, s.telemetry_pk, s.name, s.slug, s.description, p.projection_profile
     FROM dashboard_resources dr
     JOIN services s ON s.id = dr.resource_id AND s.workspace_id = ? AND s.deleted_at IS NULL
     JOIN resource_public_policies p
       ON p.workspace_id = s.workspace_id AND p.resource_type = 'service'
      AND p.resource_id = s.id AND p.effect = 'allow'
     WHERE dr.dashboard_id = ? AND dr.resource_type = 'service'
       AND dr.public_override != 'deny'
     ORDER BY dr.sort_order, s.name LIMIT 200`,
      )
      .bind(workspace.id, workspace.dashboard_id)
      .all<PublicServiceRow>()
  ).results;
  const servicePks = services.map((service) => service.telemetry_pk);
  const serviceIds = services.map((service) => service.id);
  const checks =
    serviceIds.length === 0
      ? []
      : (
          await controlDb
            .prepare(
              `SELECT telemetry_pk, service_id FROM check_configs
         WHERE enabled = 1 AND service_id IN (${placeholders(serviceIds.length)})`,
            )
            .bind(...serviceIds)
            .all<CheckIdentityRow>()
        ).results;
  const checkPks = checks.map((check) => check.telemetry_pk);
  const since = now - 24 * 60 * 60_000;
  const [latestServices, latestChecks, buckets] =
    servicePks.length === 0
      ? [
          { results: [] as PublicServiceLatestRow[] },
          { results: [] as CheckLatestRow[] },
          { results: [] as PublicStatusBucketRow[] },
        ]
      : await Promise.all([
          telemetryDb
            .prepare(
              `SELECT service_pk, state, last_transition_at FROM service_latest
           WHERE workspace_pk = ? AND service_pk IN (${placeholders(servicePks.length)})`,
            )
            .bind(workspace.telemetry_pk, ...servicePks)
            .all<PublicServiceLatestRow>(),
          checkPks.length === 0
            ? Promise.resolve({ results: [] as CheckLatestRow[] })
            : telemetryDb
                .prepare(
                  `SELECT check_pk, observed_at FROM check_latest
               WHERE workspace_pk = ? AND check_pk IN (${placeholders(checkPks.length)})`,
                )
                .bind(workspace.telemetry_pk, ...checkPks)
                .all<CheckLatestRow>(),
          telemetryDb
            .prepare(
              `SELECT resource_pk, bucket_start, state, availability_permille,
                  latency_avg_ms, summary_code
           FROM status_buckets WHERE workspace_pk = ? AND resource_type = 2
             AND bucket_seconds = 300 AND resource_pk IN (${placeholders(servicePks.length)})
             AND bucket_start >= ? ORDER BY bucket_start`,
            )
            .bind(workspace.telemetry_pk, ...servicePks, since)
            .all<PublicStatusBucketRow>(),
        ]);
  const latestByService = new Map(
    latestServices.results.map((latest) => [latest.service_pk, latest]),
  );
  const checkService = new Map(checks.map((check) => [check.telemetry_pk, check.service_id]));
  const lastCheckedByService = new Map<string, number>();
  for (const latest of latestChecks.results) {
    const serviceId = checkService.get(latest.check_pk);
    if (serviceId !== undefined) {
      lastCheckedByService.set(
        serviceId,
        Math.max(lastCheckedByService.get(serviceId) ?? 0, latest.observed_at),
      );
    }
  }
  const publicServices = services.map((service) =>
    projectPublicStatusService({
      service,
      latest: latestByService.get(service.telemetry_pk),
      lastCheckedAt: lastCheckedByService.get(service.id) ?? null,
      buckets: buckets.results,
      now,
    }),
  );

  const incidentRows =
    serviceIds.length === 0
      ? []
      : (
          await controlDb
            .prepare(
              `SELECT DISTINCT i.id, i.title, i.summary, i.severity, i.state,
                i.starts_at, i.resolved_at
         FROM incidents i JOIN incident_resources ir ON ir.incident_id = i.id
         WHERE i.workspace_id = ? AND i.deleted_at IS NULL
           AND ir.resource_type = 'service' AND ir.resource_id IN (${placeholders(serviceIds.length)})
           AND (i.state != 'resolved' OR i.resolved_at >= ?)
         ORDER BY i.starts_at DESC LIMIT 20`,
            )
            .bind(workspace.id, ...serviceIds, now - 7 * 24 * 60 * 60_000)
            .all<IncidentRow>()
        ).results;
  const incidentIds = incidentRows.map((incident) => incident.id);
  const [incidentResources, incidentUpdates] =
    incidentIds.length === 0
      ? [{ results: [] as IncidentResourceRow[] }, { results: [] as IncidentUpdateRow[] }]
      : await Promise.all([
          controlDb
            .prepare(
              `SELECT incident_id, resource_id, impact FROM incident_resources
           WHERE resource_type = 'service' AND incident_id IN (${placeholders(incidentIds.length)})`,
            )
            .bind(...incidentIds)
            .all<IncidentResourceRow>(),
          controlDb
            .prepare(
              `SELECT id, incident_id, state, body, published_at, created_at
           FROM incident_updates WHERE incident_id IN (${placeholders(incidentIds.length)})
           ORDER BY COALESCE(published_at, created_at) DESC LIMIT 200`,
            )
            .bind(...incidentIds)
            .all<IncidentUpdateRow>(),
        ]);
  const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
  const announcements = (
    await controlDb
      .prepare(
        `SELECT id, title, body, severity, starts_at, expires_at FROM announcements
     WHERE workspace_id = ? AND visibility = 'public' AND deleted_at IS NULL
       AND starts_at <= ? AND expires_at > ?
     ORDER BY starts_at DESC LIMIT 20`,
      )
      .bind(workspace.id, now, now)
      .all<AnnouncementRow>()
  ).results;
  const incidents = incidentRows.map((incident) => ({
    id: incident.id,
    title: incident.title,
    summary: incident.summary,
    severity: incident.severity,
    state: incident.state,
    startsAt: incident.starts_at,
    resolvedAt: incident.resolved_at,
    affectedServices: incidentResources.results
      .filter(
        (resource) =>
          resource.incident_id === incident.id && serviceNameById.has(resource.resource_id),
      )
      .map((resource) => ({
        name: serviceNameById.get(resource.resource_id) ?? "Service",
        impact: resource.impact,
      })),
    updates: incidentUpdates.results
      .filter((update) => update.incident_id === incident.id)
      .map((update) => ({
        id: update.id,
        state: update.state,
        body: update.body,
        publishedAt: update.published_at ?? update.created_at,
      })),
  }));
  const updatedAt = latestChecks.results.reduce<number | null>(
    (latest, check) => Math.max(latest ?? 0, check.observed_at),
    null,
  );
  return {
    workspace: { name: workspace.name, slug: workspace.slug },
    dashboard: { name: workspace.dashboard_name },
    services: publicServices,
    incidents,
    announcements: announcements.map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      severity: announcement.severity,
      startsAt: announcement.starts_at,
      expiresAt: announcement.expires_at,
    })),
    updatedAt,
  };
}
