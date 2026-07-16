export const LIVE_PROTOCOL = "alphaping.v1";
export const LIVE_TICKET_PROTOCOL_PREFIX = "alphaping.ticket.";

interface BaseLiveTicketClaims {
  version: 1;
  workspaceId: string;
  subjectId: string;
  topics: readonly string[];
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
}

export interface AgentLiveTicketClaims extends BaseLiveTicketClaims {
  role: "agent";
  projection: "internal";
  sessionId: string;
  noncePrefix: string;
}

export interface ViewerLiveTicketClaims extends BaseLiveTicketClaims {
  role: "viewer";
  projection: "machine-summary";
}

export type LiveTicketClaims = AgentLiveTicketClaims | ViewerLiveTicketClaims;

export interface ViewerTicketInput {
  workspaceId: string;
  subjectId: string;
  machinePk: number;
}

const encoder = new TextEncoder();

export function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function decodeBase64Url(value: string, maximumBytes = 4_096): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length > Math.ceil((maximumBytes * 4) / 3)) {
    throw new Error("invalid_base64url");
  }
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  if (bytes.byteLength > maximumBytes) throw new Error("invalid_base64url");
  return bytes;
}

async function keyedDigest(
  secret: string,
  label: string,
  parts: readonly Uint8Array[],
): Promise<Uint8Array> {
  if (encoder.encode(secret).byteLength < 32) throw new Error("invalid_live_ticket_secret");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const size =
    encoder.encode(label).byteLength + parts.reduce((sum, part) => sum + part.length + 1, 0);
  const input = new Uint8Array(size);
  let offset = 0;
  const labelBytes = encoder.encode(label);
  input.set(labelBytes, offset);
  offset += labelBytes.length;
  for (const part of parts) {
    input[offset] = 0;
    offset += 1;
    input.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== 32 || right.byteLength !== 32) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function validScope(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseClaims(parsed: unknown, now: number): LiveTicketClaims {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid_ticket");
  }
  const data = parsed as Readonly<Record<string, unknown>>;
  if (
    data.version !== 1 ||
    !validScope(data.workspaceId, 128) ||
    !validScope(data.subjectId, 128) ||
    !Array.isArray(data.topics) ||
    data.topics.length !== 1 ||
    !data.topics.every(
      (topic) => typeof topic === "string" && /^machine:[1-9][0-9]{0,19}$/.test(topic),
    ) ||
    !validTimestamp(data.issuedAt) ||
    !validTimestamp(data.notBefore) ||
    !validTimestamp(data.expiresAt) ||
    data.notBefore > now + 5_000 ||
    data.expiresAt <= now ||
    data.issuedAt > now + 5_000 ||
    data.notBefore < data.issuedAt - 5_000
  ) {
    throw new Error("invalid_ticket");
  }
  const base = {
    version: 1 as const,
    workspaceId: data.workspaceId,
    subjectId: data.subjectId,
    topics: data.topics as string[],
    issuedAt: data.issuedAt,
    notBefore: data.notBefore,
    expiresAt: data.expiresAt,
  };
  if (
    data.role === "viewer" &&
    data.projection === "machine-summary" &&
    data.expiresAt - data.issuedAt <= 5 * 60_000 &&
    data.sessionId === undefined &&
    data.noncePrefix === undefined
  ) {
    return { ...base, role: "viewer", projection: "machine-summary" };
  }
  if (
    data.role === "agent" &&
    data.projection === "internal" &&
    data.expiresAt - data.issuedAt <= 15 * 60_000 &&
    typeof data.sessionId === "string" &&
    decodeBase64Url(data.sessionId, 16).byteLength === 16 &&
    typeof data.noncePrefix === "string" &&
    decodeBase64Url(data.noncePrefix, 4).byteLength === 4
  ) {
    return {
      ...base,
      role: "agent",
      projection: "internal",
      sessionId: data.sessionId,
      noncePrefix: data.noncePrefix,
    };
  }
  throw new Error("invalid_ticket");
}

async function signClaims(claims: LiveTicketClaims, secret: string): Promise<string> {
  const payloadPart = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await keyedDigest(secret, "alphaping/v1/live-ticket", [
    encoder.encode(payloadPart),
  ]);
  return `${payloadPart}.${encodeBase64Url(signature)}`;
}

export async function signViewerLiveTicket(
  input: ViewerTicketInput,
  secret: string,
  now = Date.now(),
): Promise<{ ticket: string; expiresAt: number }> {
  if (!Number.isSafeInteger(input.machinePk) || input.machinePk <= 0) {
    throw new Error("invalid_machine_scope");
  }
  const expiresAt = now + 5 * 60_000;
  const ticket = await signClaims(
    {
      version: 1,
      workspaceId: input.workspaceId,
      subjectId: input.subjectId,
      role: "viewer",
      topics: [`machine:${input.machinePk}`],
      projection: "machine-summary",
      issuedAt: now,
      notBefore: Math.max(0, now - 5_000),
      expiresAt,
    },
    secret,
  );
  return { ticket, expiresAt };
}

export async function verifyLiveTicket(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<LiveTicketClaims> {
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra !== undefined || token.length > 4_096) {
    throw new Error("invalid_ticket");
  }
  const expected = await keyedDigest(secret, "alphaping/v1/live-ticket", [
    encoder.encode(payloadPart),
  ]);
  const actual = decodeBase64Url(signaturePart, 32);
  if (!timingSafeEqual(expected, actual)) throw new Error("invalid_ticket");
  const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart))) as unknown;
  return parseClaims(parsed, now);
}

export function ticketFromProtocols(request: Request): string {
  const protocols = request.headers
    .get("sec-websocket-protocol")
    ?.split(",")
    .map((item) => item.trim());
  if (!protocols?.includes(LIVE_PROTOCOL)) throw new Error("missing_live_protocol");
  const encoded = protocols.find((protocol) => protocol.startsWith(LIVE_TICKET_PROTOCOL_PREFIX));
  if (!encoded) throw new Error("missing_ticket");
  return encoded.slice(LIVE_TICKET_PROTOCOL_PREFIX.length);
}

export async function deriveAgentLiveKey(secret: string, sessionId: string): Promise<Uint8Array> {
  const sessionBytes = decodeBase64Url(sessionId, 16);
  if (sessionBytes.byteLength !== 16) throw new Error("invalid_session");
  return keyedDigest(secret, "alphaping/v1/live-key", [sessionBytes]);
}
