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
  offline_after_seconds: number;
  container_monitoring_enabled: number;
  agent_version: string | null;
  platform: string | null;
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
}

interface ServiceRow {
  id: string;
  telemetry_pk: number;
  name: string;
}

interface CheckRow {
  service_id: string;
  telemetry_pk: number;
}

interface CheckLatestRow {
  check_pk: number;
  state: "healthy" | "degraded" | "down" | "unknown";
  observed_at: number;
}

interface RollupRow {
  check_pk: number;
  bucket_start: number;
  healthy_count: number;
  degraded_count: number;
  down_count: number;
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
  agentVersion: string | null;
  platform: string | null;
  containersEnabled: boolean;
}

export interface DashboardService {
  id: string;
  name: string;
  state: "healthy" | "degraded" | "down" | "unknown";
  lastCheckedAt: number | null;
  timeline: readonly {
    bucketStart: number;
    state: "healthy" | "degraded" | "down" | "unknown";
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

function stateRank(state: DashboardService["state"]): number {
  return { unknown: 0, healthy: 1, degraded: 2, down: 3 }[state];
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
      `SELECT m.id, m.telemetry_pk, m.name, m.offline_after_seconds,
              m.container_monitoring_enabled, a.agent_version, a.platform
       FROM machines m LEFT JOIN agents a ON a.machine_id = m.id AND a.status = 'active'
       WHERE m.workspace_id = ? AND m.deleted_at IS NULL ORDER BY m.name LIMIT 500`,
    )
    .bind(workspace.id)
    .all<MachineRow>();
  const serviceRows = await controlDb
    .prepare(
      `SELECT id, telemetry_pk, name FROM services
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
                      network_rx_total, network_tx_total
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
      agentVersion: machine.agent_version,
      platform: machine.platform,
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
        `SELECT service_id, telemetry_pk FROM check_configs
         WHERE workspace_id = ? AND enabled = 1 LIMIT 1000`,
      )
      .bind(workspace.id)
      .all<CheckRow>()
  ).results.filter((check) => allowedServiceIds.has(check.service_id));
  const checkPks = checks.map((check) => check.telemetry_pk);
  const latestChecks =
    checkPks.length === 0
      ? []
      : (
          await telemetryDb
            .prepare(
              `SELECT check_pk, state, observed_at FROM check_latest
               WHERE check_pk IN (${placeholders(checkPks.length)})`,
            )
            .bind(...checkPks)
            .all<CheckLatestRow>()
        ).results;
  const historyStart = Math.floor((now - 30 * 300_000) / 300_000) * 300_000;
  const rollups =
    checkPks.length === 0
      ? []
      : (
          await telemetryDb
            .prepare(
              `SELECT check_pk, bucket_start, healthy_count, degraded_count, down_count
               FROM check_rollups_5m
               WHERE check_pk IN (${placeholders(checkPks.length)}) AND bucket_start >= ?
               ORDER BY bucket_start`,
            )
            .bind(...checkPks, historyStart)
            .all<RollupRow>()
        ).results;
  const checksByService = new Map<string, number[]>();
  for (const check of checks) {
    const group = checksByService.get(check.service_id) ?? [];
    group.push(check.telemetry_pk);
    checksByService.set(check.service_id, group);
  }
  const latestByCheck = new Map(latestChecks.map((latest) => [latest.check_pk, latest]));
  const rollupStateByCheckAndBucket = new Map<string, DashboardService["state"]>();
  for (const rollup of rollups) {
    const state: DashboardService["state"] =
      rollup.down_count > 0
        ? "down"
        : rollup.degraded_count > 0
          ? "degraded"
          : rollup.healthy_count > 0
            ? "healthy"
            : "unknown";
    rollupStateByCheckAndBucket.set(`${rollup.check_pk}:${rollup.bucket_start}`, state);
  }
  const services: readonly DashboardService[] = allowedServices.map((service) => {
    const serviceChecks = checksByService.get(service.id) ?? [];
    const current = serviceChecks
      .map((checkPk) => latestByCheck.get(checkPk))
      .filter((latest): latest is CheckLatestRow => latest !== undefined);
    const state = current.reduce<DashboardService["state"]>(
      (worst, latest) => (stateRank(latest.state) > stateRank(worst) ? latest.state : worst),
      "unknown",
    );
    const timeline = Array.from({ length: 30 }, (_, index) => {
      const bucketStart = historyStart + index * 300_000;
      const bucketState = serviceChecks.reduce<DashboardService["state"]>((worst, checkPk) => {
        const state = rollupStateByCheckAndBucket.get(`${checkPk}:${bucketStart}`) ?? "unknown";
        return stateRank(state) > stateRank(worst) ? state : worst;
      }, "unknown");
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
