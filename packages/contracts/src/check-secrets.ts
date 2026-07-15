const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AAD_PREFIX = "alphaping/check-secret/v1";

export interface WrappedCheckSecret {
  ciphertext: ArrayBuffer;
  nonce: ArrayBuffer;
}

function decodeHexKey(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("invalid_check_secret_wrapping_key");
  }
  const bytes = new Uint8Array(new ArrayBuffer(KEY_BYTES));
  for (let index = 0; index < KEY_BYTES; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function associatedData(workspaceId: string, secretId: string): Uint8Array<ArrayBuffer> {
  if (
    workspaceId.length === 0 ||
    workspaceId.length > 128 ||
    secretId.length === 0 ||
    secretId.length > 128
  ) {
    throw new Error("invalid_check_secret_scope");
  }
  return new TextEncoder().encode(`${AAD_PREFIX}:${workspaceId}:${secretId}`);
}

async function importWrappingKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeHexKey(keyHex), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function wrapCheckSecret(
  plaintext: string,
  keyHex: string,
  workspaceId: string,
  secretId: string,
): Promise<WrappedCheckSecret> {
  const value = new TextEncoder().encode(plaintext);
  if (value.byteLength === 0 || value.byteLength > 16_384) {
    throw new Error("invalid_check_secret_size");
  }
  const nonce = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(NONCE_BYTES)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: associatedData(workspaceId, secretId) },
    await importWrappingKey(keyHex),
    value,
  );
  return { ciphertext, nonce: nonce.buffer };
}

export async function unwrapCheckSecret(
  wrapped: WrappedCheckSecret,
  keyHex: string,
  workspaceId: string,
  secretId: string,
): Promise<string> {
  if (wrapped.nonce.byteLength !== NONCE_BYTES || wrapped.ciphertext.byteLength > 16_400) {
    throw new Error("invalid_check_secret_envelope");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: wrapped.nonce,
      additionalData: associatedData(workspaceId, secretId),
    },
    await importWrappingKey(keyHex),
    wrapped.ciphertext,
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}
