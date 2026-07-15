import { d1BlobToArrayBuffer, unwrapCheckSecret } from "@alphaping/contracts";

import type {
  CheckConfigRow,
  CheckSecretReferences,
  HttpCheckRequest,
  TcpCheckRequest,
} from "./types.js";
import { parseCheckSecretReferences } from "./validation.js";

interface SecretRow {
  id: string;
  wrapped_value: unknown;
  nonce: unknown;
}

interface ResolvedCheckSecrets {
  headers: Readonly<Record<string, string>>;
  body: string | null;
  tcpPayload: Uint8Array<ArrayBuffer> | null;
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function referencedIds(references: CheckSecretReferences): readonly string[] {
  return [
    ...Object.values(references.headers),
    ...(references.body === null ? [] : [references.body]),
    ...(references.tcpPayload === null ? [] : [references.tcpPayload]),
  ].filter((id, index, all) => all.indexOf(id) === index);
}

export async function resolveCheckSecrets(
  db: D1Database,
  row: CheckConfigRow,
  keyHex: string,
): Promise<ResolvedCheckSecrets> {
  const references = parseCheckSecretReferences(row.secret_refs_json);
  const ids = referencedIds(references);
  if (ids.length === 0) return { headers: {}, body: null, tcpPayload: null };
  const results = await db
    .prepare(
      `SELECT id, wrapped_value, nonce FROM check_secrets
       WHERE workspace_id = ? AND id IN (${placeholders(ids.length)})`,
    )
    .bind(row.workspace_id, ...ids)
    .all<SecretRow>();
  if (results.results.length !== ids.length) throw new Error("missing_check_secret");
  const plaintext = new Map<string, string>();
  await Promise.all(
    results.results.map(async (secret) => {
      plaintext.set(
        secret.id,
        await unwrapCheckSecret(
          {
            ciphertext: d1BlobToArrayBuffer(secret.wrapped_value),
            nonce: d1BlobToArrayBuffer(secret.nonce),
          },
          keyHex,
          row.workspace_id,
          secret.id,
        ),
      );
    }),
  );
  const value = (id: string): string => {
    const resolved = plaintext.get(id);
    if (resolved === undefined) throw new Error("missing_check_secret");
    return resolved;
  };
  const headers = Object.fromEntries(
    Object.entries(references.headers).map(([name, id]) => [name, value(id)]),
  );
  const body = references.body === null ? null : value(references.body);
  const tcpPayload =
    references.tcpPayload === null ? null : new TextEncoder().encode(value(references.tcpPayload));
  if (tcpPayload !== null && tcpPayload.byteLength > 4_096)
    throw new Error("secret_payload_too_large");
  return { headers, body, tcpPayload };
}

export function applyHttpSecrets(
  config: HttpCheckRequest,
  secrets: ResolvedCheckSecrets,
): HttpCheckRequest {
  return {
    ...config,
    headers: { ...config.headers, ...secrets.headers },
    sensitiveHeaders: Object.keys(secrets.headers).map((name) => name.toLowerCase()),
    body: secrets.body ?? config.body,
  };
}

export function applyTcpSecrets(
  config: TcpCheckRequest,
  secrets: ResolvedCheckSecrets,
): TcpCheckRequest {
  return { ...config, payload: secrets.tcpPayload ?? config.payload };
}
