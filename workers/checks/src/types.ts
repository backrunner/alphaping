export interface CheckConfigRow {
  id: string;
  telemetry_pk: number;
  workspace_telemetry_pk: number;
  workspace_id: string;
  service_telemetry_pk: number;
  service_maintenance_until: number | null;
  kind: "http" | "tcp";
  interval_seconds: number;
  phase_seconds: number;
  timeout_ms: number;
  request_json: string;
  secret_refs_json: string;
  failure_confirmations: number;
  recovery_confirmations: number;
  last_claimed_slot: number;
}

export type AssertionSource = "header" | "jsonpath" | "body";
export type AssertionOperator =
  | "exists"
  | "equals"
  | "contains"
  | "matches"
  | "type"
  | "greater_than"
  | "less_than";

export interface CheckAssertion {
  source: AssertionSource;
  operator: AssertionOperator;
  selector: string | null;
  expected: unknown;
  severity: "degraded" | "down";
}

export interface HttpCheckRequest {
  url: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Readonly<Record<string, string>>;
  sensitiveHeaders: readonly string[];
  body: string | null;
  expectedStatus: readonly number[];
  degradedAfterMs: number | null;
  downAfterMs: number | null;
  maxRedirects: number;
  tlsVerify: boolean;
  maxResponseBytes: number;
  assertions: readonly CheckAssertion[];
}

export interface TcpCheckRequest {
  hostname: string;
  port: number;
  secureTransport: "off" | "on";
  tlsVerify: boolean;
  payload: Uint8Array<ArrayBuffer> | null;
  responsePrefix: Uint8Array<ArrayBuffer> | null;
}

export interface ExecutedCheck {
  state: "healthy" | "degraded" | "down";
  latencyMs: number | null;
  failureCode: string | null;
  failureSummary: string | null;
}

export interface CheckSecretReferences {
  headers: Readonly<Record<string, string>>;
  body: string | null;
  tcpPayload: string | null;
}
