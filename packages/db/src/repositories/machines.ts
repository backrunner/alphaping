import {
  canAccessContainer,
  canAccessResource,
  type ResourceGrant,
  type ResourceType,
  type WorkspaceRole,
} from "@alphaping/authz";

import type { DashboardMachine } from "./dashboard.js";
import type {
  MachineCollection,
  MachineContainer,
  MachineContainerInventory,
  MachineDetail,
  MachineRuntimeStatus,
} from "./machine-models.js";
import { loadMachineProbeTasks } from "./machine-probes.js";

export type {
  MachineCollection,
  MachineContainer,
  MachineContainerInventory,
  MachineDetail,
  MachineProbeTask,
  MachineRuntimeStatus,
} from "./machine-models.js";

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
  agent_id: string | null;
  agent_hostname: string | null;
  agent_os_name: string | null;
  agent_os_version: string | null;
  agent_kernel_version: string | null;
  agent_created_at: number | null;
  agent_last_seen_at: number | null;
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
  container_inventory_json?: string | null;
}

interface EventRow {
  occurred_at: number;
  previous_state: string;
  current_state: string;
  reason_code: string;
}

interface AgentCommandRow {
  id: string;
  type: "check_update" | "install_version" | "redetect_runtimes" | "refresh_config";
  state: "pending" | "delivered" | "succeeded" | "failed" | "expired";
  result_code: string | null;
  created_at: number;
  completed_at: number | null;
}

interface WorkspaceAccess {
  workspace: WorkspaceRow;
  grants: readonly ResourceGrant[];
}

export class MachineNotFoundError extends Error {}

const D1_IN_BATCH_SIZE = 90;

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
       WHERE workspace_id = ? AND subject_user_id = ?
         AND resource_type IN ('machine', 'container', 'service')`,
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
                m.created_at, a.agent_version, a.platform, a.arch, a.applied_config_revision,
                a.id AS agent_id, a.hostname AS agent_hostname, a.os_name AS agent_os_name,
                a.os_version AS agent_os_version, a.kernel_version AS agent_kernel_version,
                a.created_at AS agent_created_at, a.last_seen_at AS agent_last_seen_at
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
              m.created_at, a.agent_version, a.platform, a.arch, a.applied_config_revision,
              a.id AS agent_id, a.hostname AS agent_hostname, a.os_name AS agent_os_name,
              a.os_version AS agent_os_version, a.kernel_version AS agent_kernel_version,
              a.created_at AS agent_created_at, a.last_seen_at AS agent_last_seen_at
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
  const statements = [];
  for (let offset = 0; offset < machinePks.length; offset += D1_IN_BATCH_SIZE) {
    const batch = machinePks.slice(offset, offset + D1_IN_BATCH_SIZE);
    statements.push(
      telemetryDb
        .prepare(
          `SELECT machine_pk, observed_at, received_at, state, cpu_permille,
                memory_used_bytes, memory_total_bytes, storage_used_bytes, storage_total_bytes,
                network_rx_bps, network_tx_bps, network_rx_total, network_tx_total,
                load_1m_milli, uptime_seconds
         FROM machine_latest WHERE machine_pk IN (${placeholders(batch.length)})`,
        )
        .bind(...batch),
    );
  }
  const results = await telemetryDb.batch<MachineLatestRow>(statements);
  return results.flatMap((result) => result.results);
}

async function loadLatestDetailRow(
  telemetryDb: D1Database,
  machinePk: number,
): Promise<MachineLatestRow | null> {
  return telemetryDb
    .prepare(
      `SELECT machine_pk, observed_at, received_at, state, cpu_permille,
              memory_used_bytes, memory_total_bytes, storage_used_bytes, storage_total_bytes,
              network_rx_bps, network_tx_bps, network_rx_total, network_tx_total,
              load_1m_milli, uptime_seconds, container_inventory_json
       FROM machine_latest WHERE machine_pk = ?`,
    )
    .bind(machinePk)
    .first<MachineLatestRow>();
}

const runtimeKinds = new Set<MachineRuntimeStatus["kind"]>([
  "docker",
  "colima-docker",
  "colima-containerd",
  "apple-container",
  "unknown",
]);
const runtimeAvailability = new Set<MachineRuntimeStatus["availability"]>([
  "available",
  "absent",
  "stopped",
  "permission-denied",
  "incompatible",
  "error",
  "unknown",
]);
const containerStates = new Set<MachineContainer["state"]>([
  "created",
  "running",
  "paused",
  "restarting",
  "exited",
  "dead",
  "unknown",
]);
const containerHealth = new Set<MachineContainer["health"]>([
  "none",
  "starting",
  "healthy",
  "unhealthy",
  "unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function safeInteger(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
}

export function parseContainerInventory(value: string | null): MachineContainerInventory | null {
  if (!value || value.length > 256 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.runtimes) || !Array.isArray(parsed.containers)) {
    return null;
  }
  const observedAt = safeInteger(parsed.observedAt);
  if (observedAt === null || parsed.runtimes.length > 16 || parsed.containers.length > 64)
    return null;
  const runtimes: MachineRuntimeStatus[] = [];
  for (const item of parsed.runtimes) {
    if (!isRecord(item)) return null;
    const kind = boundedString(item.kind, 32);
    const availability = boundedString(item.availability, 32);
    const instance = boundedString(item.instance, 64);
    const version = boundedString(item.version, 64);
    const detailCode = boundedString(item.detailCode, 64);
    if (
      !kind ||
      !runtimeKinds.has(kind as MachineRuntimeStatus["kind"]) ||
      !availability ||
      !runtimeAvailability.has(availability as MachineRuntimeStatus["availability"]) ||
      instance === null ||
      version === null ||
      detailCode === null
    ) {
      return null;
    }
    runtimes.push({
      kind: kind as MachineRuntimeStatus["kind"],
      availability: availability as MachineRuntimeStatus["availability"],
      instance,
      version,
      detailCode,
    });
  }
  const containers: MachineContainer[] = [];
  for (const item of parsed.containers) {
    if (!isRecord(item) || !Array.isArray(item.ports) || item.ports.length > 8) return null;
    const id = boundedString(item.id, 32);
    const runtime = boundedString(item.runtime, 32);
    const runtimeInstance = boundedString(item.runtimeInstance, 64);
    const name = boundedString(item.name, 128);
    const image = boundedString(item.image, 512);
    const state = boundedString(item.state, 32);
    const health = boundedString(item.health, 32);
    if (
      !id ||
      !/^[a-f0-9]{32}$/.test(id) ||
      !runtime ||
      !runtimeKinds.has(runtime as MachineRuntimeStatus["kind"]) ||
      runtimeInstance === null ||
      name === null ||
      image === null ||
      !state ||
      !containerStates.has(state as MachineContainer["state"]) ||
      !health ||
      !containerHealth.has(health as MachineContainer["health"])
    ) {
      return null;
    }
    const numbers = [
      item.startedAt,
      item.restartCount,
      item.cpuPermille,
      item.memoryUsedBytes,
      item.memoryLimitBytes,
      item.networkRxBps,
      item.networkTxBps,
    ].map((number) => safeInteger(number));
    if (numbers.some((number) => number === null)) return null;
    const ports = item.ports.map((port) => {
      if (!isRecord(port)) return null;
      const privatePort = safeInteger(port.privatePort);
      const publicPort = safeInteger(port.publicPort);
      const protocol = boundedString(port.protocol, 8);
      if (privatePort === null || publicPort === null || protocol === null) return null;
      return { privatePort, publicPort, protocol };
    });
    if (ports.some((port) => port === null)) return null;
    containers.push({
      id,
      runtime: runtime as MachineRuntimeStatus["kind"],
      runtimeInstance,
      name,
      image,
      state: state as MachineContainer["state"],
      health: health as MachineContainer["health"],
      startedAt: numbers[0] ?? 0,
      restartCount: numbers[1] ?? 0,
      cpuPermille: numbers[2] ?? 0,
      memoryUsedBytes: numbers[3] ?? 0,
      memoryLimitBytes: numbers[4] ?? 0,
      networkRxBps: numbers[5] ?? 0,
      networkTxBps: numbers[6] ?? 0,
      ports: ports.filter((port): port is NonNullable<typeof port> => port !== null),
    });
  }
  return { observedAt, runtimes, containers };
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
    labels: parseLabels(machine.labels_json),
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
    load1mMilli: latest?.load_1m_milli ?? null,
    uptimeSeconds: latest?.uptime_seconds ?? null,
    agentVersion: machine.agent_version,
    platform: machine.platform,
    arch: machine.arch,
    containersEnabled: machine.container_monitoring_enabled === 1,
  };
}

function nonempty(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

export function resolveLastMachineError(
  commands: readonly {
    type: AgentCommandRow["type"];
    state: AgentCommandRow["state"];
    result_code: string | null;
    created_at: number;
    completed_at: number | null;
  }[],
  inventory: MachineContainerInventory | null,
): MachineDetail["lastError"] {
  const failedCommand = commands
    .filter((command) => command.state === "failed")
    .map((command) => ({
      code: nonempty(command.result_code) ?? "command_failed",
      source: "agent-command" as const,
      sourceLabel: command.type,
      occurredAt: command.completed_at ?? command.created_at,
    }))
    .sort((left, right) => right.occurredAt - left.occurredAt)[0];
  const runtimeError = inventory?.runtimes
    .filter((runtime) =>
      ["stopped", "permission-denied", "incompatible", "error"].includes(runtime.availability),
    )
    .map((runtime) => ({
      code: nonempty(runtime.detailCode) ?? runtime.availability,
      source: "container-runtime" as const,
      sourceLabel: runtime.instance ? `${runtime.kind}:${runtime.instance}` : runtime.kind,
      occurredAt: inventory.observedAt,
    }))[0];
  if (!failedCommand) return runtimeError ?? null;
  if (!runtimeError) return failedCommand;
  return failedCommand.occurredAt >= runtimeError.occurredAt ? failedCommand : runtimeError;
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
): Promise<{ workspaceId: string; workspacePk: number; machinePk: number }> {
  const { access, machine } = await loadAuthorizedMachine(
    controlDb,
    workspaceSlug,
    userId,
    machineId,
  );
  return {
    workspaceId: access.workspace.id,
    workspacePk: access.workspace.telemetry_pk,
    machinePk: machine.telemetry_pk,
  };
}

export async function loadMachineCurrent(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
  now = Date.now(),
): Promise<{ latest: DashboardMachine; latestReceivedAt: number | null }> {
  const { machine } = await loadAuthorizedMachine(controlDb, workspaceSlug, userId, machineId);
  const latestRows = await loadLatestRows(telemetryDb, [machine.telemetry_pk]);
  return {
    latest: toDashboardMachine(machine, latestRows[0], now),
    latestReceivedAt: latestRows[0]?.received_at ?? null,
  };
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
  const latestRow = await loadLatestDetailRow(telemetryDb, machine.telemetry_pk);
  const inventory = parseContainerInventory(latestRow?.container_inventory_json ?? null);
  const canManage = canAccessResource(
    access.workspace.role,
    access.grants,
    "machine",
    machine.id,
    "manage",
  );
  const events = await telemetryDb
    .prepare(
      `SELECT occurred_at, previous_state, current_state, reason_code FROM state_events
       WHERE workspace_pk = ? AND resource_type = 1 AND resource_pk = ?
       ORDER BY occurred_at DESC LIMIT 20`,
    )
    .bind(access.workspace.telemetry_pk, machine.telemetry_pk)
    .all<EventRow>();
  const probeTasks = await loadMachineProbeTasks(
    controlDb,
    telemetryDb,
    {
      workspaceId: access.workspace.id,
      role: access.workspace.role,
      grants: access.grants,
    },
    machine.agent_id,
    now,
  );
  const commandRows = machine.agent_id
    ? await controlDb
        .prepare(
          `SELECT id, type, state, result_code, created_at, completed_at
             FROM agent_commands WHERE agent_id = ?
             ORDER BY created_at DESC LIMIT 8`,
        )
        .bind(machine.agent_id)
        .all<AgentCommandRow>()
    : { results: [] as AgentCommandRow[] };
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
    latest: toDashboardMachine(machine, latestRow ?? undefined, now),
    latestReceivedAt: latestRow?.received_at ?? null,
    agent: machine.agent_id
      ? {
          id: machine.agent_id,
          version: machine.agent_version ?? "",
          platform: machine.platform ?? "",
          arch: machine.arch ?? "",
          hostname: nonempty(machine.agent_hostname),
          osName: nonempty(machine.agent_os_name),
          osVersion: nonempty(machine.agent_os_version),
          kernelVersion: nonempty(machine.agent_kernel_version),
          appliedConfigRevision: machine.applied_config_revision ?? 0,
          enrolledAt: machine.agent_created_at ?? machine.created_at,
          lastSeenAt: machine.agent_last_seen_at,
        }
      : null,
    lastError: resolveLastMachineError(commandRows.results, inventory),
    agentCommands: canManage
      ? commandRows.results.map((command) => ({
          id: command.id,
          type: command.type,
          state: command.state,
          resultCode: command.result_code,
          createdAt: command.created_at,
          completedAt: command.completed_at,
        }))
      : [],
    events: events.results.map((event) => ({
      occurredAt: event.occurred_at,
      previousState: event.previous_state,
      currentState: event.current_state,
      reasonCode: event.reason_code,
    })),
    containerInventory: inventory
      ? {
          ...inventory,
          containers: inventory.containers.filter((container) =>
            canAccessContainer(
              access.workspace.role,
              access.grants,
              machine.id,
              container.id,
              "view",
            ),
          ),
        }
      : null,
    probeTasks,
    canManage,
  };
}
