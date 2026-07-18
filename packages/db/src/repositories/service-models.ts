import type { ResourceGrant, ResourceType, WorkspaceRole } from "@alphaping/authz";

export type MonitorState = "healthy" | "degraded" | "down" | "maintenance" | "unknown";

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  telemetry_pk: number;
  role: WorkspaceRole;
}

export interface GrantRow {
  resource_type: ResourceType;
  resource_id: string;
  capability: "view" | "manage";
  effect: "allow" | "deny";
}

export interface ServiceRow {
  id: string;
  telemetry_pk: number;
  name: string;
  slug: string | null;
  description: string;
  maintenance_until: number | null;
  created_at: number;
}

export interface CheckRow {
  id: string;
  telemetry_pk: number;
  service_id: string;
  name: string;
  kind: "http" | "tcp" | "icmp";
  executor_kind: "cloudflare" | "agent";
  executor_agent_id: string | null;
  enabled: number;
  interval_seconds: number;
  timeout_ms: number;
  retry_count: number;
  critical: number;
  request_json: string;
  secret_refs_json: string;
  failure_confirmations: number;
  recovery_confirmations: number;
}

export interface ServiceCheckAssertionEdit {
  source: "header" | "jsonpath" | "body";
  operator: "exists" | "equals" | "contains" | "matches" | "type" | "greater_than" | "less_than";
  selector: string;
  expected: string;
  severity: "degraded" | "down";
}

export interface ServiceCheckEditConfiguration {
  executorAgentId: string | null;
  url: string;
  method: string;
  expectedStatuses: string;
  maxRedirects: number;
  tlsVerify: boolean;
  degradedAfterMs: number | null;
  downAfterMs: number | null;
  maxResponseBytes: number;
  requestHeaders: string;
  requestBody: string;
  hostname: string;
  serverName: string;
  port: number | null;
  useTls: boolean;
  tcpPayload: string;
  tcpResponsePrefix: string;
  assertions: readonly ServiceCheckAssertionEdit[];
  secretHeaderNames: readonly string[];
  hasSecretBody: boolean;
  hasSecretTcpPayload: boolean;
}

export interface ServiceLatestRow {
  service_pk: number;
  state: string;
  status_since: number;
  reason_code: string;
  last_transition_at: number;
}

export interface CheckLatestRow {
  check_pk: number;
  observed_at: number;
  state: string;
  latency_ms: number | null;
  failure_code: string | null;
  failure_summary: string | null;
  consecutive_failures: number;
  consecutive_successes: number;
  critical: number;
}

export interface StatusBucketRow {
  resource_pk: number;
  bucket_start: number;
  state: string;
  availability_permille: number;
  latency_avg_ms: number | null;
  latency_max_ms: number | null;
  summary_code: string;
}

export interface EventRow {
  occurred_at: number;
  previous_state: string;
  current_state: string;
  reason_code: string;
}

export interface WorkspaceAccess {
  workspace: WorkspaceRow;
  grants: readonly ResourceGrant[];
}

export interface ServiceTimelineBucket {
  bucketStart: number;
  state: MonitorState;
  availabilityPermille: number | null;
  latencyMs: number | null;
  summaryCode: string | null;
}

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  state: MonitorState;
  checkCount: number;
  lastCheckedAt: number | null;
  lastTransitionAt: number | null;
  latencyMs: number | null;
  availability24hPermille: number | null;
  timeline: readonly ServiceTimelineBucket[];
  canManage: boolean;
}

export interface ServiceCheckSummary {
  id: string;
  name: string;
  kind: CheckRow["kind"];
  executorKind: CheckRow["executor_kind"];
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  retryCount: number;
  critical: boolean;
  failureConfirmations: number;
  recoveryConfirmations: number;
  target: string;
  assertionCount: number;
  state: Exclude<MonitorState, "maintenance">;
  observedAt: number | null;
  latencyMs: number | null;
  failureCode: string | null;
  failureSummary: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  editConfiguration: ServiceCheckEditConfiguration | null;
}

export interface ServiceCollection {
  workspace: { id: string; name: string; slug: string; role: WorkspaceRole };
  services: readonly ServiceSummary[];
}

export interface ServiceDetail {
  workspace: ServiceCollection["workspace"];
  service: ServiceSummary & { maintenanceUntil: number | null; createdAt: number };
  checks: readonly ServiceCheckSummary[];
  events: readonly {
    occurredAt: number;
    previousState: MonitorState;
    currentState: MonitorState;
    reasonCode: string;
  }[];
  publicAccess: boolean;
}
