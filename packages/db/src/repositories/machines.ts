import {
  canAccessResource,
  type ResourceGrant,
  type ResourceType,
  type WorkspaceRole,
} from "@alphaping/authz";

import type { DashboardMachine } from "./dashboard.js";
import type { MachineCollection, MachineDetail } from "./machine-models.js";

export type { MachineCollection, MachineDetail } from "./machine-models.js";

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
  description: string;
  expected_host: string | null;
  labels_json: string;
  sampling_interval_seconds: number;
  report_interval_seconds: number;
  offline_after_seconds: number;
  container_monitoring_enabled: number;
  maintenance_until: number | null;
  desired_config_revision: number;
  created_at: number;
  agent_version: string | null;
  platform: string | null;
  arch: string | null;
  applied_config_revision: number | null;
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

interface EventRow {
  occurred_at: number;
  previous_state: string;
  current_state: string;
  reason_code: string;
}

interface WorkspaceAccess {
  workspace: WorkspaceRow;
  grants: readonly ResourceGrant[];
}

export class MachineNotFoundError extends Error {}

async function loadWorkspaceAccess(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<WorkspaceAccess> {
  const workspace = await db
    .prepare(
      `SELECT w.id, w.name, w.slug, w.telemetry_pk, m.role
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE w.slug = ? AND w.deleted_at IS NULL AND m.user_id = ? AND m.status = 'active'`,
    )
    .bind(workspaceSlug, userId)
    .first<WorkspaceRow>();
  if (!workspace) throw new MachineNotFoundError();
  const rows = await db
    .prepare(
      `SELECT resource_type, resource_id, capability, effect FROM resource_grants
       WHERE workspace_id = ? AND subject_user_id = ? AND resource_type = 'machine'`,
    )
    .bind(workspace.id, userId)
    .all<GrantRow>();
  return {
    workspace,
    grants: rows.results.map((grant) => ({
      resourceType: grant.resource_type,
      resourceId: grant.resource_id,
      capability: grant.capability,
      effect: grant.effect,
    })),
  };
}

async function loadMachineRows(
  db: D1Database,
  workspaceId: string,
): Promise<readonly MachineRow[]> {
  return (
    await db
      .prepare(
        `SELECT m.id, m.telemetry_pk, m.name, m.description, m.expected_host, m.labels_json,
                m.sampling_interval_seconds, m.report_interval_seconds, m.offline_after_seconds,
                m.container_monitoring_enabled, m.maintenance_until, m.desired_config_revision,
                m.created_at, a.agent_version, a.platform, a.arch, a.applied_config_revision
         FROM machines m LEFT JOIN agents a ON a.machine_id = m.id AND a.status = 'active'
         WHERE m.workspace_id = ? AND m.deleted_at IS NULL ORDER BY m.name LIMIT 500`,
      )
      .bind(workspaceId)
      .all<MachineRow>()
  ).results;
}

async function loadMachineRow(
  db: D1Database,
  workspaceId: string,
  machineId: string,
): Promise<MachineRow | null> {
  return db
    .prepare(
      `SELECT m.id, m.telemetry_pk, m.name, m.description, m.expected_host, m.labels_json,
              m.sampling_interval_seconds, m.report_interval_seconds, m.offline_after_seconds,
              m.container_monitoring_enabled, m.maintenance_until, m.desired_config_revision,
              m.created_at, a.agent_version, a.platform, a.arch, a.applied_config_revision
       FROM machines m LEFT JOIN agents a ON a.machine_id = m.id AND a.status = 'active'
       WHERE m.workspace_id = ? AND m.id = ? AND m.deleted_at IS NULL`,
    )
    .bind(workspaceId, machineId)
    .first<MachineRow>();
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

async function loadLatestRows(
  telemetryDb: D1Database,
  machinePks: readonly number[],
): Promise<readonly MachineLatestRow[]> {
  if (machinePks.length === 0) return [];
  return (
    await telemetryDb
      .prepare(
        `SELECT machine_pk, observed_at, received_at, state, cpu_permille,
                memory_used_bytes, memory_total_bytes, storage_used_bytes, storage_total_bytes,
                network_rx_bps, network_tx_bps, network_rx_total, network_tx_total
         FROM machine_latest WHERE machine_pk IN (${placeholders(machinePks.length)})`,
      )
      .bind(...machinePks)
      .all<MachineLatestRow>()
  ).results;
}

function normalizeState(state: string): DashboardMachine["state"] {
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

function toDashboardMachine(
  machine: MachineRow,
  latest: MachineLatestRow | undefined,
  now: number,
): DashboardMachine {
  const stale = latest ? now - latest.received_at > machine.offline_after_seconds * 1_000 : false;
  return {
    id: machine.id,
    name: machine.name,
    state: !latest ? "unknown" : stale ? "offline" : normalizeState(latest.state),
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

export async function loadMachineCollection(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  now = Date.now(),
): Promise<MachineCollection> {
  const access = await loadWorkspaceAccess(controlDb, workspaceSlug, userId);
  const rows = (await loadMachineRows(controlDb, access.workspace.id)).filter((machine) =>
    canAccessResource(access.workspace.role, access.grants, "machine", machine.id, "view"),
  );
  const latest = await loadLatestRows(
    telemetryDb,
    rows.map((machine) => machine.telemetry_pk),
  );
  const latestByPk = new Map(latest.map((row) => [row.machine_pk, row]));
  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
    },
    machines: rows.map((machine) =>
      toDashboardMachine(machine, latestByPk.get(machine.telemetry_pk), now),
    ),
  };
}

async function loadAuthorizedMachine(
  controlDb: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
): Promise<{ access: WorkspaceAccess; machine: MachineRow }> {
  const access = await loadWorkspaceAccess(controlDb, workspaceSlug, userId);
  const machine = await loadMachineRow(controlDb, access.workspace.id, machineId);
  if (
    !machine ||
    !canAccessResource(access.workspace.role, access.grants, "machine", machine.id, "view")
  ) {
    throw new MachineNotFoundError();
  }
  return { access, machine };
}

export async function loadAuthorizedMachineScope(
  controlDb: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
): Promise<{ workspacePk: number; machinePk: number }> {
  const { access, machine } = await loadAuthorizedMachine(
    controlDb,
    workspaceSlug,
    userId,
    machineId,
  );
  return { workspacePk: access.workspace.telemetry_pk, machinePk: machine.telemetry_pk };
}

export async function loadMachineDetail(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
  now = Date.now(),
): Promise<MachineDetail> {
  const { access, machine } = await loadAuthorizedMachine(
    controlDb,
    workspaceSlug,
    userId,
    machineId,
  );
  const latestRows = await loadLatestRows(telemetryDb, [machine.telemetry_pk]);
  const events = await telemetryDb
    .prepare(
      `SELECT occurred_at, previous_state, current_state, reason_code FROM state_events
       WHERE workspace_pk = ? AND resource_type = 1 AND resource_pk = ?
       ORDER BY occurred_at DESC LIMIT 20`,
    )
    .bind(access.workspace.telemetry_pk, machine.telemetry_pk)
    .all<EventRow>();
  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
    },
    machine: {
      id: machine.id,
      name: machine.name,
      description: machine.description,
      expectedHost: machine.expected_host,
      labels: parseLabels(machine.labels_json),
      samplingIntervalSeconds: machine.sampling_interval_seconds,
      reportIntervalSeconds: machine.report_interval_seconds,
      offlineAfterSeconds: machine.offline_after_seconds,
      containersEnabled: machine.container_monitoring_enabled === 1,
      maintenanceUntil: machine.maintenance_until,
      desiredConfigRevision: machine.desired_config_revision,
      createdAt: machine.created_at,
    },
    latest: toDashboardMachine(machine, latestRows[0], now),
    latestReceivedAt: latestRows[0]?.received_at ?? null,
    agent:
      machine.agent_version && machine.platform && machine.arch
        ? {
            version: machine.agent_version,
            platform: machine.platform,
            arch: machine.arch,
            appliedConfigRevision: machine.applied_config_revision ?? 0,
          }
        : null,
    events: events.results.map((event) => ({
      occurredAt: event.occurred_at,
      previousState: event.previous_state,
      currentState: event.current_state,
      reasonCode: event.reason_code,
    })),
    canManage: canAccessResource(
      access.workspace.role,
      access.grants,
      "machine",
      machine.id,
      "manage",
    ),
  };
}
