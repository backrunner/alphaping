import type { WorkspaceRole } from "@alphaping/authz";

import type { DashboardMachine } from "./dashboard.js";

export interface MachineCollection {
  workspace: { id: string; name: string; slug: string; role: WorkspaceRole };
  machines: readonly DashboardMachine[];
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
  canManage: boolean;
}
