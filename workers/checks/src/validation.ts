import type {
  AssertionOperator,
  AssertionSource,
  CheckAssertion,
  CheckSecretReferences,
  HttpCheckRequest,
  TcpCheckRequest,
} from "./types.js";

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
const ASSERTION_SOURCES = new Set<AssertionSource>(["header", "jsonpath", "body"]);
const ASSERTION_OPERATORS = new Set<AssertionOperator>([
  "exists",
  "equals",
  "contains",
  "matches",
  "type",
  "greater_than",
  "less_than",
]);

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

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error("invalid_integer");
  }
  return Number(value);
}

function parseAssertions(value: unknown): readonly CheckAssertion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("invalid_assertions");
  return value.map((raw) => {
    const assertion = asRecord(raw);
    if (
      !ASSERTION_SOURCES.has(assertion.source as AssertionSource) ||
      !ASSERTION_OPERATORS.has(assertion.operator as AssertionOperator) ||
      (assertion.severity !== "degraded" && assertion.severity !== "down")
    ) {
      throw new Error("invalid_assertion");
    }
    const selector =
      assertion.selector === undefined || assertion.selector === null
        ? null
        : String(assertion.selector);
    if (selector !== null && (selector.length === 0 || selector.length > 512)) {
      throw new Error("invalid_assertion_selector");
    }
    if (assertion.source === "header" && selector === null) {
      throw new Error("missing_header_selector");
    }
    if (assertion.source === "jsonpath") {
      if (selector === null || !selector.startsWith("$") || selector.includes("(")) {
        throw new Error("unsafe_jsonpath_selector");
      }
    }
    if (assertion.operator === "matches") {
      if (typeof assertion.expected !== "string") throw new Error("invalid_regex_assertion");
      if (assertion.expected.length > 256) throw new Error("regex_assertion_too_large");
    }
    if (typeof assertion.expected === "string" && assertion.expected.length > 2_048) {
      throw new Error("assertion_expected_too_large");
    }
    return {
      source: assertion.source as AssertionSource,
      operator: assertion.operator as AssertionOperator,
      selector,
      expected: assertion.expected,
      severity: assertion.severity,
    };
  });
}

function decodeBase64(value: unknown, field: string): Uint8Array<ArrayBuffer> | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 5_464) throw new Error(`invalid_${field}`);
  try {
    const binary = atob(value);
    if (binary.length > 4_096) throw new Error(`invalid_${field}`);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error(`invalid_${field}`);
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
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(String(method))) {
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
    data.degradedAfterMs === null || data.degradedAfterMs === undefined
      ? null
      : boundedInteger(data.degradedAfterMs, 0, 0, 30_000);
  const downAfterMs =
    data.downAfterMs === null || data.downAfterMs === undefined
      ? null
      : boundedInteger(data.downAfterMs, 0, 0, 30_000);
  if (degradedAfterMs !== null && downAfterMs !== null && downAfterMs < degradedAfterMs) {
    throw new Error("invalid_latency_thresholds");
  }

  return {
    url: url.toString(),
    method: method as HttpCheckRequest["method"],
    headers,
    sensitiveHeaders: [],
    body,
    expectedStatus,
    degradedAfterMs,
    downAfterMs,
    maxRedirects: boundedInteger(data.maxRedirects, 3, 0, 3),
    maxResponseBytes: boundedInteger(data.maxResponseBytes, 65_536, 1_024, 262_144),
    assertions: parseAssertions(data.assertions),
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
    payload: decodeBase64(data.payloadBase64, "tcp_payload"),
    responsePrefix: decodeBase64(data.responsePrefixBase64, "tcp_response_prefix"),
  };
}

export function parseCheckSecretReferences(json: string): CheckSecretReferences {
  const data = asRecord(JSON.parse(json) as unknown);
  const rawHeaders = data.headers === undefined ? {} : asRecord(data.headers);
  if (Object.keys(rawHeaders).length > 32) throw new Error("too_many_secret_headers");
  const headers: Record<string, string> = {};
  for (const [name, secretId] of Object.entries(rawHeaders)) {
    if (
      name.length > 128 ||
      BLOCKED_HEADERS.has(name.toLowerCase()) ||
      typeof secretId !== "string"
    ) {
      throw new Error("invalid_secret_header_reference");
    }
    headers[name] = secretId;
  }
  const body = data.body === undefined || data.body === null ? null : String(data.body);
  const tcpPayload =
    data.tcpPayload === undefined || data.tcpPayload === null ? null : String(data.tcpPayload);
  for (const secretId of [body, tcpPayload]) {
    if (secretId !== null && (secretId.length === 0 || secretId.length > 128)) {
      throw new Error("invalid_secret_reference");
    }
  }
  return { headers, body, tcpPayload };
}
