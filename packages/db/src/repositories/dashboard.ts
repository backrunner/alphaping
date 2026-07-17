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
  telemetry_pk: number;
  role: WorkspaceRole;
}

interface GrantRow {
  resource_type: ResourceType;
  resource_id: string;
  capability: "view" | "manage";
  effect: "allow" | "deny";
}

interface MachineRow {
  id: string;
  telemetry_pk: number;
  name: string;
  labels_json: string;
  offline_after_seconds: number;
  container_monitoring_enabled: number;
  agent_version: string | null;
  platform: string | null;
  arch: string | null;
}

interface MachineLatestRow {
  machine_pk: number;
  observed_at: number;
  received_at: number;
  state: string;
  cpu_permille: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  storage_used_bytes: number;
  storage_total_bytes: number;
  network_rx_bps: number;
  network_tx_bps: number;
  network_rx_total: number;
  network_tx_total: number;
  load_1m_milli: number | null;
  uptime_seconds: number | null;
}

interface ServiceRow {
  id: string;
  telemetry_pk: number;
  name: string;
  maintenance_until: number | null;
}

interface CheckRow {
  service_id: string;
  telemetry_pk: number;
  critical: number;
}

interface CheckLatestRow {
  check_pk: number;
  state: "healthy" | "degraded" | "down" | "unknown";
  observed_at: number;
}

interface ServiceLatestRow {
  service_pk: number;
  state: DashboardService["state"];
}

interface ServiceBucketRow {
  resource_pk: number;
  bucket_start: number;
  state: DashboardService["timeline"][number]["state"];
}

interface IncidentRow {
  id: string;
}

interface IncidentResourceRow {
  incident_id: string;
  resource_id: string;
}

export interface DashboardMachine {
  id: string;
  name: string;
  labels: Readonly<Record<string, string>>;
  state: "healthy" | "degraded" | "down" | "offline" | "maintenance" | "unknown";
  observedAt: number | null;
  cpuPermille: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  storageUsedBytes: number;
  storageTotalBytes: number;
  networkRxBps: number;
  networkTxBps: number;
  networkRxTotal: number;
  networkTxTotal: number;
  load1mMilli: number | null;
  uptimeSeconds: number | null;
  agentVersion: string | null;
  platform: string | null;
  arch: string | null;
  containersEnabled: boolean;
}

export interface DashboardService {
  id: string;
  name: string;
  state: "healthy" | "degraded" | "down" | "maintenance" | "unknown";
  lastCheckedAt: number | null;
  timeline: readonly {
    bucketStart: number;
    state: "healthy" | "degraded" | "down" | "maintenance" | "unknown";
  }[];
}

export interface DashboardSnapshot {
  workspace: { id: string; name: string; slug: string; role: WorkspaceRole };
  summary: {
    machines: number;
    online: number;
    impaired: number;
    offline: number;
    networkRxBps: number;
    networkTxBps: number;
    networkRxTotal: number;
    networkTxTotal: number;
    servicesDown: number;
    activeIncidents: number;
  };
  machines: readonly DashboardMachine[];
  services: readonly DashboardService[];
}

export class DashboardNotFoundError extends Error {}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function parseLabels(value: string): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export async function loadDashboardSnapshot(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  now = Date.now(),
): Promise<DashboardSnapshot> {
  const workspace = await controlDb
    .prepare(
      `SELECT w.id, w.name, w.slug, w.telemetry_pk, m.role
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE w.slug = ? AND w.deleted_at IS NULL AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, userId)
    .first<WorkspaceRow>();
  if (!workspace) throw new DashboardNotFoundError();

  const grantsResult = await controlDb
    .prepare(
      `SELECT resource_type, resource_id, capability, effect FROM resource_grants
       WHERE workspace_id = ? AND subject_user_id = ?`,
    )
    .bind(workspace.id, userId)
    .all<GrantRow>();
  const grants: readonly ResourceGrant[] = grantsResult.results.map((grant) => ({
    resourceType: grant.resource_type,
    resourceId: grant.resource_id,
    capability: grant.capability,
    effect: grant.effect,
  }));
  const machineRows = await controlDb
    .prepare(
      `SELECT m.id, m.telemetry_pk, m.name, m.labels_json, m.offline_after_seconds,
              m.container_monitoring_enabled, a.agent_version, a.platform, a.arch
       FROM machines m LEFT JOIN agents a ON a.machine_id = m.id AND a.status = 'active'
       WHERE m.workspace_id = ? AND m.deleted_at IS NULL ORDER BY m.name LIMIT 500`,
    )
    .bind(workspace.id)
    .all<MachineRow>();
  const serviceRows = await controlDb
    .prepare(
      `SELECT id, telemetry_pk, name, maintenance_until FROM services
       WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name LIMIT 500`,
    )
    .bind(workspace.id)
    .all<ServiceRow>();
  const allowedMachines = machineRows.results.filter((machine) =>
    canAccessResource(workspace.role, grants, "machine", machine.id, "view"),
  );
  const allowedServices = serviceRows.results.filter((service) =>
    canAccessResource(workspace.role, grants, "service", service.id, "view"),
  );

  const machinePks = allowedMachines.map((machine) => machine.telemetry_pk);
  const latestMachines =
    machinePks.length === 0
      ? []
      : (
          await telemetryDb
            .prepare(
              `SELECT machine_pk, observed_at, received_at, state, cpu_permille,
                      memory_used_bytes, memory_total_bytes, storage_used_bytes,
                      storage_total_bytes, network_rx_bps, network_tx_bps,
                      network_rx_total, network_tx_total, load_1m_milli, uptime_seconds
               FROM machine_latest WHERE machine_pk IN (${placeholders(machinePks.length)})`,
            )
            .bind(...machinePks)
            .all<MachineLatestRow>()
        ).results;
  const latestByMachine = new Map(latestMachines.map((latest) => [latest.machine_pk, latest]));
  const machines: readonly DashboardMachine[] = allowedMachines.map((machine) => {
    const latest = latestByMachine.get(machine.telemetry_pk);
    const stale = latest ? now - latest.received_at > machine.offline_after_seconds * 1_000 : false;
    const state = !latest ? "unknown" : stale ? "offline" : normalizeMachineState(latest.state);
    return {
      id: machine.id,
      name: machine.name,
      labels: parseLabels(machine.labels_json),
      state,
      observedAt: latest?.observed_at ?? null,
      cpuPermille: latest?.cpu_permille ?? 0,
      memoryUsedBytes: latest?.memory_used_bytes ?? 0,
      memoryTotalBytes: latest?.memory_total_bytes ?? 0,
      storageUsedBytes: latest?.storage_used_bytes ?? 0,
      storageTotalBytes: latest?.storage_total_bytes ?? 0,
      networkRxBps: latest?.network_rx_bps ?? 0,
      networkTxBps: latest?.network_tx_bps ?? 0,
      networkRxTotal: latest?.network_rx_total ?? 0,
      networkTxTotal: latest?.network_tx_total ?? 0,
      load1mMilli: latest?.load_1m_milli ?? null,
      uptimeSeconds: latest?.uptime_seconds ?? null,
      agentVersion: machine.agent_version,
      platform: machine.platform,
      arch: machine.arch,
      containersEnabled: machine.container_monitoring_enabled === 1,
    };
  });

  const allowedServiceIds = new Set(allowedServices.map((service) => service.id));
  const activeIncidents = (
    await controlDb
      .prepare(
        `SELECT id FROM incidents
         WHERE workspace_id = ? AND deleted_at IS NULL AND state != 'resolved'
         ORDER BY starts_at DESC LIMIT 500`,
      )
      .bind(workspace.id)
      .all<IncidentRow>()
  ).results;
  const activeIncidentIds = activeIncidents.map((incident) => incident.id);
  const activeIncidentResources =
    activeIncidentIds.length === 0
      ? []
      : (
          await controlDb
            .prepare(
              `SELECT incident_id, resource_id FROM incident_resources
               WHERE resource_type = 'service'
                 AND incident_id IN (${placeholders(activeIncidentIds.length)})`,
            )
            .bind(...activeIncidentIds)
            .all<IncidentResourceRow>()
        ).results;
  const activeIncidentCount = activeIncidents.filter(
    (incident) =>
      workspace.role === "admin" ||
      canAccessResource(workspace.role, grants, "incident", incident.id, "view") ||
      activeIncidentResources.some(
        (resource) =>
          resource.incident_id === incident.id && allowedServiceIds.has(resource.resource_id),
      ),
  ).length;
  const checks = (
    await controlDb
      .prepare(
        `SELECT service_id, telemetry_pk, critical FROM check_configs
         WHERE workspace_id = ? AND enabled = 1 LIMIT 1000`,
      )
      .bind(workspace.id)
      .all<CheckRow>()
  ).results.filter((check) => allowedServiceIds.has(check.service_id));
  const checkPks = checks.map((check) => check.telemetry_pk);
  const historyStart = Math.floor((now - 30 * 300_000) / 300_000) * 300_000;
  const servicePks = allowedServices.map((service) => service.telemetry_pk);
  const [latestChecks, latestServices, serviceBuckets] = await Promise.all([
    checkPks.length === 0
      ? Promise.resolve({ results: [] as CheckLatestRow[] })
      : telemetryDb
          .prepare(
            `SELECT check_pk, state, observed_at FROM check_latest
             WHERE check_pk IN (${placeholders(checkPks.length)})`,
          )
          .bind(...checkPks)
          .all<CheckLatestRow>(),
    servicePks.length === 0
      ? Promise.resolve({ results: [] as ServiceLatestRow[] })
      : telemetryDb
          .prepare(
            `SELECT service_pk, state FROM service_latest
             WHERE workspace_pk = ? AND service_pk IN (${placeholders(servicePks.length)})`,
          )
          .bind(workspace.telemetry_pk, ...servicePks)
          .all<ServiceLatestRow>(),
    servicePks.length === 0
      ? Promise.resolve({ results: [] as ServiceBucketRow[] })
      : telemetryDb
          .prepare(
            `SELECT resource_pk, bucket_start, state FROM status_buckets
             WHERE workspace_pk = ? AND resource_type = 2 AND bucket_seconds = 300
               AND resource_pk IN (${placeholders(servicePks.length)}) AND bucket_start >= ?
             ORDER BY bucket_start`,
          )
          .bind(workspace.telemetry_pk, ...servicePks, historyStart)
          .all<ServiceBucketRow>(),
  ]);
  const checksByService = new Map<string, number[]>();
  for (const check of checks) {
    const group = checksByService.get(check.service_id) ?? [];
    group.push(check.telemetry_pk);
    checksByService.set(check.service_id, group);
  }
  const latestByCheck = new Map(latestChecks.results.map((latest) => [latest.check_pk, latest]));
  const criticalByCheck = new Map(
    checks.map((check) => [check.telemetry_pk, check.critical === 1]),
  );
  const latestByService = new Map(
    latestServices.results.map((latest) => [latest.service_pk, latest.state]),
  );
  const bucketByServiceAndTime = new Map(
    serviceBuckets.results.map((bucket) => [
      `${bucket.resource_pk}:${bucket.bucket_start}`,
      bucket.state,
    ]),
  );
  const services: readonly DashboardService[] = allowedServices.map((service) => {
    const serviceChecks = checksByService.get(service.id) ?? [];
    const current = serviceChecks
      .map((checkPk) => latestByCheck.get(checkPk))
      .filter((latest): latest is CheckLatestRow => latest !== undefined);
    const fallbackState: DashboardService["state"] = current.some(
      (latest) => latest.state === "down" && criticalByCheck.get(latest.check_pk),
    )
      ? "down"
      : current.some((latest) => latest.state === "down" || latest.state === "degraded")
        ? "degraded"
        : current.some((latest) => latest.state === "healthy")
          ? "healthy"
          : "unknown";
    const state: DashboardService["state"] =
      service.maintenance_until !== null && service.maintenance_until > now
        ? "maintenance"
        : (latestByService.get(service.telemetry_pk) ?? fallbackState);
    const timeline = Array.from({ length: 30 }, (_, index) => {
      const bucketStart = historyStart + index * 300_000;
      const bucketState =
        bucketByServiceAndTime.get(`${service.telemetry_pk}:${bucketStart}`) ?? "unknown";
      return { bucketStart, state: bucketState };
    });
    return {
      id: service.id,
      name: service.name,
      state,
      lastCheckedAt: current.reduce<number | null>(
        (latest, check) => Math.max(latest ?? 0, check.observed_at),
        null,
      ),
      timeline,
    };
  });
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: workspace.role,
    },
    summary: {
      machines: machines.length,
      online: machines.filter((machine) => machine.state === "healthy").length,
      impaired: machines.filter(
        (machine) => machine.state === "degraded" || machine.state === "down",
      ).length,
      offline: machines.filter((machine) => machine.state === "offline").length,
      networkRxBps: machines.reduce((total, machine) => total + machine.networkRxBps, 0),
      networkTxBps: machines.reduce((total, machine) => total + machine.networkTxBps, 0),
      networkRxTotal: machines.reduce((total, machine) => total + machine.networkRxTotal, 0),
      networkTxTotal: machines.reduce((total, machine) => total + machine.networkTxTotal, 0),
      servicesDown: services.filter((service) => service.state === "down").length,
      activeIncidents: activeIncidentCount,
    },
    machines,
    services,
  };
}

function normalizeMachineState(state: string): DashboardMachine["state"] {
  if (
    state === "healthy" ||
    state === "degraded" ||
    state === "down" ||
    state === "offline" ||
    state === "maintenance"
  ) {
    return state;
  }
  return "unknown";
}
