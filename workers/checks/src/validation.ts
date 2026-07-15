import type { HttpCheckRequest, TcpCheckRequest } from "./types.js";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const BLOCKED_HEADERS = new Set([
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
  "upgrade",
]);
const PRIVATE_V4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const PRIVATE_V6 = /^(?:::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid_check_config");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function assertPublicHostname(hostname: string): void {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized.length === 0 ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    BLOCKED_HOSTNAMES.has(normalized) ||
    PRIVATE_V4.test(normalized) ||
    PRIVATE_V6.test(normalized)
  ) {
    throw new Error("blocked_target");
  }
}

export function parseHttpRequest(json: string): HttpCheckRequest {
  const data = asRecord(JSON.parse(json) as unknown);
  if (typeof data.url !== "string" || data.url.length > 2_048) {
    throw new Error("invalid_url");
  }
  const url = new URL(data.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("invalid_protocol");
  }
  assertPublicHostname(url.hostname);

  const method = data.method ?? "GET";
  if (!["GET", "HEAD", "POST", "PUT", "PATCH"].includes(String(method))) {
    throw new Error("invalid_method");
  }
  const expectedStatus = Array.isArray(data.expectedStatus)
    ? data.expectedStatus.filter((item): item is number => Number.isInteger(item))
    : [200];
  if (expectedStatus.length === 0 || expectedStatus.length > 20) {
    throw new Error("invalid_expected_status");
  }
  const body = data.body === null || data.body === undefined ? null : String(data.body);
  if (body !== null && new TextEncoder().encode(body).byteLength > 16_384) {
    throw new Error("request_body_too_large");
  }
  const rawHeaders = data.headers === undefined ? {} : asRecord(data.headers);
  if (Object.keys(rawHeaders).length > 32) {
    throw new Error("too_many_headers");
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (
      name.length > 128 ||
      BLOCKED_HEADERS.has(name.toLowerCase()) ||
      typeof value !== "string" ||
      value.length > 1_024
    ) {
      throw new Error("invalid_header");
    }
    headers[name] = value;
  }
  const degradedAfterMs =
    typeof data.degradedAfterMs === "number" && data.degradedAfterMs >= 0
      ? data.degradedAfterMs
      : null;

  return {
    url: url.toString(),
    method: method as HttpCheckRequest["method"],
    headers,
    body,
    expectedStatus,
    degradedAfterMs,
  };
}

export function parseTcpRequest(json: string): TcpCheckRequest {
  const data = asRecord(JSON.parse(json) as unknown);
  if (typeof data.hostname !== "string" || data.hostname.length > 253) {
    throw new Error("invalid_hostname");
  }
  assertPublicHostname(data.hostname);
  if (!Number.isInteger(data.port) || Number(data.port) < 1 || Number(data.port) > 65_535) {
    throw new Error("invalid_port");
  }
  return {
    hostname: data.hostname,
    port: Number(data.port),
    secureTransport: data.secureTransport === "on" ? "on" : "off",
  };
}
