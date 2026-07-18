import {
  projectPublicStatusMachine,
  projectPublicStatusService,
  type PublicContainerRow,
  type PublicMachineLatestRow,
  type PublicMachineRow,
  type PublicStatusMachine,
  type PublicServiceLatestRow,
  type PublicServiceRow,
  type PublicStatusBucketRow,
  type PublicStatusService,
} from "./public-status-projection.js";
import { queryInBatches } from "./d1-query-batches.js";
import { parseContainerInventory } from "./machines.js";

export {
  projectPublicStatusMachine,
  projectPublicStatusService,
} from "./public-status-projection.js";
export type { PublicStatusMachine, PublicStatusService } from "./public-status-projection.js";

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

interface PublicContainerQueryRow extends PublicContainerRow {
  name_sort_key: string;
  id_sort_key: string;
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
  machines: readonly PublicStatusMachine[];
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  const machines = (
    await controlDb
      .prepare(
        `SELECT m.id, m.telemetry_pk, m.name, m.description, m.offline_after_seconds,
                p.projection_profile
         FROM dashboard_resources dr
         JOIN machines m ON m.id = dr.resource_id AND m.workspace_id = ? AND m.deleted_at IS NULL
         JOIN resource_public_policies p
           ON p.workspace_id = m.workspace_id AND p.resource_type = 'machine'
          AND p.resource_id = m.id AND p.effect = 'allow'
         WHERE dr.dashboard_id = ? AND dr.resource_type = 'machine'
           AND dr.public_override != 'deny'
         ORDER BY dr.sort_order, m.name LIMIT 200`,
      )
      .bind(workspace.id, workspace.dashboard_id)
      .all<PublicMachineRow>()
  ).results;
  const machinePks = machines.map((machine) => machine.telemetry_pk);
  const machineIds = machines.map((machine) => machine.id);
  const [latestMachines, publicContainerRows] = await Promise.all([
    queryInBatches<PublicMachineLatestRow, number>(telemetryDb, machinePks, (batch) =>
      telemetryDb
        .prepare(
          `SELECT machine_pk, observed_at, received_at, state, cpu_permille,
                    memory_used_bytes, memory_total_bytes, storage_used_bytes,
                    storage_total_bytes, network_rx_bps, network_tx_bps,
                    container_inventory_json
             FROM machine_latest WHERE workspace_pk = ?
               AND machine_pk IN (${placeholders(batch.length)})`,
        )
        .bind(workspace.telemetry_pk, ...batch),
    ),
    queryInBatches<PublicContainerQueryRow, string>(controlDb, machineIds, (batch) =>
      controlDb
        .prepare(
          `SELECT c.id, c.machine_id, p.projection_profile,
                    hex(c.name) AS name_sort_key, hex(c.id) AS id_sort_key
             FROM containers c
             JOIN resource_public_policies p
               ON p.workspace_id = c.workspace_id AND p.resource_type = 'container'
              AND p.resource_id = c.id AND p.effect = 'allow'
             WHERE c.workspace_id = ? AND c.deleted_at IS NULL
               AND c.machine_id IN (${placeholders(batch.length)})
             ORDER BY c.name, c.id LIMIT 500`,
        )
        .bind(workspace.id, ...batch),
    ),
  ]);
  const publicContainers = publicContainerRows
    .sort(
      (left, right) =>
        compareText(left.name_sort_key, right.name_sort_key) ||
        compareText(left.id_sort_key, right.id_sort_key),
    )
    .slice(0, 500);
  const latestByMachine = new Map(latestMachines.map((latest) => [latest.machine_pk, latest]));
  const publicMachines = machines.map((machine) => {
    const latest = latestByMachine.get(machine.telemetry_pk);
    return projectPublicStatusMachine({
      machine,
      latest,
      inventory: parseContainerInventory(latest?.container_inventory_json ?? null),
      publicContainers: publicContainers.filter((container) => container.machine_id === machine.id),
      now,
    });
  });
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
  const checks = await queryInBatches<CheckIdentityRow, string>(controlDb, serviceIds, (batch) =>
    controlDb
      .prepare(
        `SELECT telemetry_pk, service_id FROM check_configs
           WHERE workspace_id = ? AND enabled = 1
             AND service_id IN (${placeholders(batch.length)})`,
      )
      .bind(workspace.id, ...batch),
  );
  const checkPks = checks.map((check) => check.telemetry_pk);
  const since = now - 24 * 60 * 60_000;
  const [latestServices, latestChecks, buckets] = await Promise.all([
    queryInBatches<PublicServiceLatestRow, number>(telemetryDb, servicePks, (batch) =>
      telemetryDb
        .prepare(
          `SELECT service_pk, state, last_transition_at FROM service_latest
               WHERE workspace_pk = ? AND service_pk IN (${placeholders(batch.length)})`,
        )
        .bind(workspace.telemetry_pk, ...batch),
    ),
    queryInBatches<CheckLatestRow, number>(telemetryDb, checkPks, (batch) =>
      telemetryDb
        .prepare(
          `SELECT check_pk, observed_at FROM check_latest
                   WHERE workspace_pk = ? AND check_pk IN (${placeholders(batch.length)})`,
        )
        .bind(workspace.telemetry_pk, ...batch),
    ),
    queryInBatches<PublicStatusBucketRow, number>(telemetryDb, servicePks, (batch) =>
      telemetryDb
        .prepare(
          `SELECT resource_pk, bucket_start, state, availability_permille,
                  latency_avg_ms, summary_code
               FROM status_buckets WHERE workspace_pk = ? AND resource_type = 2
                 AND bucket_seconds = 300 AND resource_pk IN (${placeholders(batch.length)})
                 AND bucket_start >= ? ORDER BY bucket_start`,
        )
        .bind(workspace.telemetry_pk, ...batch, since),
    ),
  ]);
  const latestByService = new Map(latestServices.map((latest) => [latest.service_pk, latest]));
  const checkService = new Map(checks.map((check) => [check.telemetry_pk, check.service_id]));
  const lastCheckedByService = new Map<string, number>();
  for (const latest of latestChecks) {
    const serviceId = checkService.get(latest.check_pk);
    if (serviceId !== undefined) {
      lastCheckedByService.set(
        serviceId,
        Math.max(lastCheckedByService.get(serviceId) ?? 0, latest.observed_at),
      );
    }
  }
  const bucketsByService = new Map<number, PublicStatusBucketRow[]>();
  for (const bucket of buckets) {
    const serviceBuckets = bucketsByService.get(bucket.resource_pk) ?? [];
    serviceBuckets.push(bucket);
    bucketsByService.set(bucket.resource_pk, serviceBuckets);
  }
  const publicServices = services.map((service) =>
    projectPublicStatusService({
      service,
      latest: latestByService.get(service.telemetry_pk),
      lastCheckedAt: lastCheckedByService.get(service.id) ?? null,
      buckets: bucketsByService.get(service.telemetry_pk) ?? [],
      now,
    }),
  );

  const incidentCandidates = await queryInBatches<IncidentRow, string>(
    controlDb,
    serviceIds,
    (batch) =>
      controlDb
        .prepare(
          `SELECT DISTINCT i.id, i.title, i.summary, i.severity, i.state,
                i.starts_at, i.resolved_at
         FROM incidents i JOIN incident_resources ir ON ir.incident_id = i.id
         WHERE i.workspace_id = ? AND i.deleted_at IS NULL
           AND ir.resource_type = 'service' AND ir.resource_id IN (${placeholders(batch.length)})
           AND (i.state != 'resolved' OR i.resolved_at >= ?)
         ORDER BY i.starts_at DESC, i.id LIMIT 20`,
        )
        .bind(workspace.id, ...batch, now - 7 * 24 * 60 * 60_000),
  );
  const incidentRows = [...new Map(incidentCandidates.map((row) => [row.id, row])).values()]
    .sort((left, right) => right.starts_at - left.starts_at || compareText(left.id, right.id))
    .slice(0, 20);
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
  const serviceUpdatedAt = latestChecks.reduce<number | null>(
    (latest, check) => Math.max(latest ?? 0, check.observed_at),
    null,
  );
  const updatedAt = latestMachines.reduce<number | null>(
    (latest, machine) => Math.max(latest ?? 0, machine.observed_at),
    serviceUpdatedAt,
  );
  return {
    workspace: { name: workspace.name, slug: workspace.slug },
    dashboard: { name: workspace.dashboard_name },
    machines: publicMachines,
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
