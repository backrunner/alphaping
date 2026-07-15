export interface LiveTicketClaims {
  workspaceId: string;
  subjectId: string;
  role: "agent" | "viewer";
  topics: readonly string[];
  expiresAt: number;
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return bytes;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
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
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart)),
  );
  const actual = decodeBase64Url(signaturePart);
  if (!timingSafeEqual(expected, actual)) throw new Error("invalid_ticket");

  const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart))) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid_ticket");
  }
  const data = parsed as Readonly<Record<string, unknown>>;
  if (
    typeof data.workspaceId !== "string" ||
    typeof data.subjectId !== "string" ||
    (data.role !== "agent" && data.role !== "viewer") ||
    !Array.isArray(data.topics) ||
    !data.topics.every((topic) => typeof topic === "string" && topic.length <= 128) ||
    typeof data.expiresAt !== "number" ||
    data.expiresAt <= now ||
    data.expiresAt > now + 10 * 60_000
  ) {
    throw new Error("invalid_ticket");
  }
  return {
    workspaceId: data.workspaceId,
    subjectId: data.subjectId,
    role: data.role,
    topics: data.topics,
    expiresAt: data.expiresAt,
  };
}

export function ticketFromProtocols(request: Request): string {
  const protocols = request.headers
    .get("sec-websocket-protocol")
    ?.split(",")
    .map((item) => item.trim());
  const encoded = protocols?.find((protocol) => protocol.startsWith("alphaping.ticket."));
  if (!encoded) throw new Error("missing_ticket");
  return encoded.slice("alphaping.ticket.".length);
}
