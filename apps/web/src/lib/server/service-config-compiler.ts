import { wrapCheckSecret } from "@alphaping/contracts";
import { error } from "@sveltejs/kit";

type CheckKind = "http" | "tcp" | "icmp";
type ExecutorKind = "cloudflare" | "agent";
type AssertionSource = "header" | "jsonpath" | "body";
type AssertionOperator =
  | "exists"
  | "equals"
  | "contains"
  | "matches"
  | "type"
  | "greater_than"
  | "less_than";

export interface ServiceAssertionInput {
  source: AssertionSource;
  operator: AssertionOperator;
  selector: string;
  expected: string;
  severity: "degraded" | "down";
}

export interface CreateServiceMonitorInput {
  name: string;
  description: string;
  kind: CheckKind;
  executorKind: ExecutorKind;
  executorAgentId: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureConfirmations: number;
  recoveryConfirmations: number;
  url: string;
  method: string;
  expectedStatuses: string;
  maxRedirects: number;
  tlsVerify: boolean;
  degradedAfterMs: number | null;
  downAfterMs: number | null;
  maxResponseBytes: number;
  requestHeaders: string;
  secretRequestHeaders: string;
  requestBody: string;
  requestBodyIsSecret: boolean;
  hostname: string;
  serverName: string;
  port: number | null;
  useTls: boolean;
  tcpPayload: string;
  tcpPayloadIsSecret: boolean;
  tcpResponsePrefix: string;
  assertions: readonly ServiceAssertionInput[];
}

export interface CheckSecretInsert {
  id: string;
  name: string;
  wrappedValue: ArrayBuffer;
  nonce: ArrayBuffer;
}

interface CompiledAssertion extends Omit<ServiceAssertionInput, "selector" | "expected"> {
  selector: string | null;
  expected: unknown;
}

export interface CompiledServiceConfig {
  request: Readonly<Record<string, unknown>>;
  assertions: readonly CompiledAssertion[];
  secretRefs: {
    headers: Readonly<Record<string, string>>;
    body: string | null;
    tcpPayload: string | null;
  };
  secrets: readonly CheckSecretInsert[];
}

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
const CHECK_KINDS: readonly CheckKind[] = ["http", "tcp", "icmp"];
const EXECUTOR_KINDS: readonly ExecutorKind[] = ["cloudflare", "agent"];
const ASSERTION_SOURCES: readonly AssertionSource[] = ["header", "jsonpath", "body"];
const ASSERTION_OPERATORS: readonly AssertionOperator[] = [
  "exists",
  "equals",
  "contains",
  "matches",
  "type",
  "greater_than",
  "less_than",
];

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw error(400, `${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function boundedUtf8(value: string, maximumBytes: number, label: string): void {
  if (new TextEncoder().encode(value).byteLength > maximumBytes) {
    throw error(400, `${label} is limited to ${maximumBytes} bytes`);
  }
}

function parseHeaderLines(value: string): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  const names = new Set<string>();
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 32) throw error(400, "A check can contain at most 32 request headers");
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw error(400, "Request headers must use Name: value format");
    const name = line.slice(0, separator).trim();
    const headerValue = line.slice(separator + 1).trim();
    const normalizedName = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) ||
      BLOCKED_HEADERS.has(normalizedName) ||
      headerValue.length > 1_024
    ) {
      throw error(400, `Request header ${name || "value"} is invalid`);
    }
    if (names.has(normalizedName)) throw error(400, `Request header ${name} is duplicated`);
    names.add(normalizedName);
    headers[name] = headerValue;
  }
  return headers;
}

function expectedStatuses(value: string): readonly number[] {
  const statuses = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);
  if (
    statuses.length === 0 ||
    statuses.length > 20 ||
    statuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)
  ) {
    throw error(400, "Expected statuses must be a comma-separated list between 100 and 599");
  }
  return [...new Set(statuses)];
}

function assertionExpected(input: ServiceAssertionInput): unknown {
  if (input.operator === "exists") return null;
  if (input.operator === "greater_than" || input.operator === "less_than") {
    const number = Number(input.expected);
    if (!Number.isFinite(number)) throw error(400, "Numeric assertions require a number");
    return number;
  }
  if (input.operator === "type") {
    if (!["string", "number", "boolean", "object", "array", "null"].includes(input.expected)) {
      throw error(400, "Type assertion is invalid");
    }
    return input.expected;
  }
  if (input.operator === "equals") {
    try {
      return JSON.parse(input.expected) as unknown;
    } catch {
      return input.expected;
    }
  }
  return input.expected;
}

function compileAssertions(inputs: readonly ServiceAssertionInput[]): readonly CompiledAssertion[] {
  if (inputs.length > 20) throw error(400, "A check can contain at most 20 assertions");
  return inputs.map((input) => {
    if (
      !ASSERTION_SOURCES.includes(input.source) ||
      !ASSERTION_OPERATORS.includes(input.operator) ||
      (input.severity !== "degraded" && input.severity !== "down")
    ) {
      throw error(400, "Assertion options are invalid");
    }
    if (input.selector.length > 512 || input.expected.length > 2_048) {
      throw error(400, "Assertion input is too long");
    }
    if (input.operator === "matches" && input.expected.length > 256) {
      throw error(400, "Regular expression assertions are limited to 256 characters");
    }
    if (
      input.source === "jsonpath" &&
      (!input.selector.startsWith("$") || input.selector.includes("("))
    ) {
      throw error(400, "JSONPath must use a non-executable selector beginning with $");
    }
    if (input.source === "header" && input.selector.length === 0) {
      throw error(400, "Header assertions require a header name");
    }
    return { ...input, selector: input.selector || null, expected: assertionExpected(input) };
  });
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > 4_096) throw error(400, "TCP payloads are limited to 4096 bytes");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function wrapSecrets(
  input: Readonly<Record<string, string>>,
  workspaceId: string,
  keyHex: string,
): Promise<{
  references: Readonly<Record<string, string>>;
  inserts: readonly CheckSecretInsert[];
}> {
  const entries = await Promise.all(
    Object.entries(input).map(async ([name, value]) => {
      const id = crypto.randomUUID();
      const wrapped = await wrapCheckSecret(value, keyHex, workspaceId, id);
      return { name, id, wrappedValue: wrapped.ciphertext, nonce: wrapped.nonce };
    }),
  );
  return {
    references: Object.fromEntries(entries.map((entry) => [entry.name, entry.id])),
    inserts: entries,
  };
}

function compileRequest(
  input: CreateServiceMonitorInput,
  headers: Readonly<Record<string, string>>,
  assertions: readonly CompiledAssertion[],
): Readonly<Record<string, unknown>> {
  if (input.kind === "http") {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw error(400, "Service URL is invalid");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw error(400, "HTTP checks require an HTTP or HTTPS URL");
    }
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(input.method)) {
      throw error(400, "HTTP method is invalid");
    }
    return {
      url: url.toString(),
      method: input.method,
      headers,
      body: input.requestBodyIsSecret || input.requestBody === "" ? null : input.requestBody,
      expectedStatus: expectedStatuses(input.expectedStatuses),
      maxRedirects: boundedInteger(input.maxRedirects, 0, 3, "Redirect limit"),
      tlsVerify: input.tlsVerify,
      degradedAfterMs: input.degradedAfterMs,
      downAfterMs: input.downAfterMs,
      maxResponseBytes: boundedInteger(input.maxResponseBytes, 1_024, 262_144, "Response limit"),
      assertions,
    };
  }
  if (input.hostname.length === 0 || input.hostname.length > 253) {
    throw error(400, "Target hostname is invalid");
  }
  return input.kind === "tcp"
    ? {
        hostname: input.hostname,
        port: boundedInteger(input.port ?? 0, 1, 65_535, "TCP port"),
        secureTransport: input.useTls ? "on" : "off",
        serverName: input.serverName || null,
        tlsVerify: input.tlsVerify,
        payloadBase64:
          input.tcpPayloadIsSecret || input.tcpPayload === "" ? null : base64Utf8(input.tcpPayload),
        responsePrefixBase64:
          input.tcpResponsePrefix === "" ? null : base64Utf8(input.tcpResponsePrefix),
      }
    : {
        hostname: input.hostname,
        degradedAfterMs: input.degradedAfterMs,
        downAfterMs: input.downAfterMs,
      };
}

export async function compileServiceConfig(
  input: CreateServiceMonitorInput,
  workspaceId: string,
  wrappingKey: string,
): Promise<CompiledServiceConfig> {
  if (input.name.length < 2 || input.name.length > 80 || input.description.length > 500) {
    throw error(400, "Service name or description is invalid");
  }
  if (!CHECK_KINDS.includes(input.kind) || !EXECUTOR_KINDS.includes(input.executorKind)) {
    throw error(400, "Check type or executor is invalid");
  }
  if (input.executorKind === "cloudflare" && !input.tlsVerify) {
    throw error(400, "Cloudflare checks require TLS certificate verification");
  }
  if (input.executorKind === "cloudflare" && input.kind === "tcp" && input.serverName) {
    throw error(400, "TCP SNI requires an Agent executor");
  }
  boundedInteger(
    input.intervalSeconds,
    input.executorKind === "cloudflare" ? 60 : 5,
    86_400,
    "Check interval",
  );
  boundedInteger(input.timeoutMs, 100, 30_000, "Timeout");
  boundedInteger(input.failureConfirmations, 1, 20, "Failure confirmations");
  boundedInteger(input.recoveryConfirmations, 1, 20, "Recovery confirmations");
  if (input.executorKind === "cloudflare" && input.kind === "icmp") {
    throw error(400, "Cloudflare cannot execute ICMP checks; select an Agent executor");
  }
  if (input.kind === "http") boundedUtf8(input.requestBody, 16_384, "HTTP request body");
  if (input.kind === "tcp") boundedUtf8(input.tcpPayload, 4_096, "TCP payload");
  if (input.serverName.length > 253 || /\s/.test(input.serverName)) {
    throw error(400, "TLS server name is invalid");
  }
  const assertions = compileAssertions(input.assertions);
  const publicHeaders = parseHeaderLines(input.requestHeaders);
  const secretHeaders = parseHeaderLines(input.secretRequestHeaders);
  const secretNames = new Set(Object.keys(secretHeaders).map((name) => name.toLowerCase()));
  if (Object.keys(publicHeaders).some((name) => secretNames.has(name.toLowerCase()))) {
    throw error(400, "A request header cannot be both public and secret");
  }
  const secretValues: Record<string, string> = Object.fromEntries(
    Object.entries(secretHeaders).map(([name, value]) => [`header:${name}`, value]),
  );
  if (input.requestBodyIsSecret && input.requestBody) secretValues.body = input.requestBody;
  if (input.tcpPayloadIsSecret && input.tcpPayload) secretValues.tcpPayload = input.tcpPayload;
  const wrapped = await wrapSecrets(secretValues, workspaceId, wrappingKey);
  const secretHeaderReferences: Record<string, string> = {};
  for (const name of Object.keys(secretHeaders)) {
    const reference = wrapped.references[`header:${name}`];
    if (!reference) throw error(500, "Secret header wrapping produced an incomplete reference set");
    secretHeaderReferences[name] = reference;
  }
  return {
    request: compileRequest(input, publicHeaders, assertions),
    assertions,
    secretRefs: {
      headers: secretHeaderReferences,
      body: wrapped.references.body ?? null,
      tcpPayload: wrapped.references.tcpPayload ?? null,
    },
    secrets: wrapped.inserts,
  };
}
