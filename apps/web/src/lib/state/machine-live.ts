import type { DashboardMachine } from "@alphaping/db";

export interface MachineLiveTicket {
  url: string;
  ticket: string;
  topic: string;
  expiresAt: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMachineLiveTicket(value: unknown, now = Date.now()): MachineLiveTicket {
  if (!isRecord(value)) throw new Error("invalid_live_ticket_response");
  let endpoint: URL;
  try {
    endpoint = new URL(typeof value.url === "string" ? value.url : "");
  } catch {
    throw new Error("invalid_live_ticket_response");
  }
  if (
    endpoint.protocol !== "wss:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.hash !== "" ||
    typeof value.ticket !== "string" ||
    value.ticket.length > 4_096 ||
    typeof value.topic !== "string" ||
    !/^machine:[1-9][0-9]{0,19}$/.test(value.topic) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= now
  ) {
    throw new Error("invalid_live_ticket_response");
  }
  return {
    url: endpoint.toString(),
    ticket: value.ticket,
    topic: value.topic,
    expiresAt: value.expiresAt,
  };
}

const machineStates = new Set<DashboardMachine["state"]>([
  "healthy",
  "degraded",
  "down",
  "offline",
  "maintenance",
  "unknown",
]);

function isMachineState(value: unknown): value is DashboardMachine["state"] {
  return typeof value === "string" && machineStates.has(value as DashboardMachine["state"]);
}

function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseMachineLiveFallback(value: unknown): DashboardMachine {
  if (!isRecord(value) || !isRecord(value.latest)) throw new Error("invalid_live_fallback");
  const latest = value.latest;
  const observedAt = latest.observedAt === null ? null : metric(latest.observedAt);
  const cpuPermille = metric(latest.cpuPermille);
  const memoryUsedBytes = metric(latest.memoryUsedBytes);
  const memoryTotalBytes = metric(latest.memoryTotalBytes);
  const storageUsedBytes = metric(latest.storageUsedBytes);
  const storageTotalBytes = metric(latest.storageTotalBytes);
  const networkRxBps = metric(latest.networkRxBps);
  const networkTxBps = metric(latest.networkTxBps);
  const networkRxTotal = metric(latest.networkRxTotal);
  const networkTxTotal = metric(latest.networkTxTotal);
  if (
    typeof latest.id !== "string" ||
    typeof latest.name !== "string" ||
    !isMachineState(latest.state) ||
    (observedAt === null && latest.observedAt !== null) ||
    cpuPermille === null ||
    cpuPermille > 1_000 ||
    memoryUsedBytes === null ||
    memoryTotalBytes === null ||
    storageUsedBytes === null ||
    storageTotalBytes === null ||
    networkRxBps === null ||
    networkTxBps === null ||
    networkRxTotal === null ||
    networkTxTotal === null ||
    (latest.agentVersion !== null && typeof latest.agentVersion !== "string") ||
    (latest.platform !== null && typeof latest.platform !== "string") ||
    typeof latest.containersEnabled !== "boolean"
  ) {
    throw new Error("invalid_live_fallback");
  }
  return {
    id: latest.id,
    name: latest.name,
    state: latest.state,
    observedAt,
    cpuPermille,
    memoryUsedBytes,
    memoryTotalBytes,
    storageUsedBytes,
    storageTotalBytes,
    networkRxBps,
    networkTxBps,
    networkRxTotal,
    networkTxTotal,
    agentVersion: latest.agentVersion,
    platform: latest.platform,
    containersEnabled: latest.containersEnabled,
  };
}
