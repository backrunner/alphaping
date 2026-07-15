export interface CheckConfigRow {
  id: string;
  telemetry_pk: number;
  workspace_telemetry_pk: number;
  kind: "http" | "tcp";
  interval_seconds: number;
  phase_seconds: number;
  timeout_ms: number;
  request_json: string;
  last_claimed_slot: number;
}

export interface HttpCheckRequest {
  url: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH";
  headers: Readonly<Record<string, string>>;
  body: string | null;
  expectedStatus: readonly number[];
  degradedAfterMs: number | null;
}

export interface TcpCheckRequest {
  hostname: string;
  port: number;
  secureTransport: "off" | "on";
}

export interface ExecutedCheck {
  state: "healthy" | "degraded" | "down";
  latencyMs: number | null;
  failureCode: string | null;
}
