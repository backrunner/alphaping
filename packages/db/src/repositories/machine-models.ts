import type { WorkspaceRole } from "@alphaping/authz";

import type { DashboardMachine } from "./dashboard.js";

export interface MachineCollection {
  workspace: { id: string; name: string; slug: string; role: WorkspaceRole };
  machines: readonly DashboardMachine[];
}

export interface MachineRuntimeStatus {
  kind: "docker" | "colima-docker" | "colima-containerd" | "apple-container" | "unknown";
  instance: string;
  availability:
    | "available"
    | "absent"
    | "stopped"
    | "permission-denied"
    | "incompatible"
    | "error"
    | "unknown";
  version: string;
  detailCode: string;
}

export interface MachineContainer {
  id: string;
  runtime: MachineRuntimeStatus["kind"];
  runtimeInstance: string;
  name: string;
  image: string;
  state: "created" | "running" | "paused" | "restarting" | "exited" | "dead" | "unknown";
  health: "none" | "starting" | "healthy" | "unhealthy" | "unknown";
  startedAt: number;
  restartCount: number;
  cpuPermille: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  networkRxBps: number;
  networkTxBps: number;
  ports: readonly { privatePort: number; publicPort: number; protocol: string }[];
}

export interface MachineContainerInventory {
  observedAt: number;
  runtimes: readonly MachineRuntimeStatus[];
  containers: readonly MachineContainer[];
}

export interface MachineDetail {
  workspace: { id: string; name: string; slug: string; role: WorkspaceRole };
  machine: {
    id: string;
    name: string;
    description: string;
    expectedHost: string | null;
    labels: Readonly<Record<string, string>>;
    samplingIntervalSeconds: number;
    reportIntervalSeconds: number;
    offlineAfterSeconds: number;
    containersEnabled: boolean;
    maintenanceUntil: number | null;
    desiredConfigRevision: number;
    createdAt: number;
  };
  latest: DashboardMachine;
  latestReceivedAt: number | null;
  agent: {
    version: string;
    platform: string;
    arch: string;
    appliedConfigRevision: number;
  } | null;
  events: readonly {
    occurredAt: number;
    previousState: string;
    currentState: string;
    reasonCode: string;
  }[];
  containerInventory: MachineContainerInventory | null;
  canManage: boolean;
}
