const MAX_CONFIG_BYTES = 16_384;

export interface WrappedNotificationConfig {
  ciphertext: ArrayBuffer;
  nonce: ArrayBuffer;
}

function decodeKey(keyHex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error("invalid_notification_wrapping_key");
  }
  return Uint8Array.from(keyHex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function additionalData(workspaceId: string, channelId: string): Uint8Array<ArrayBuffer> {
  if (!workspaceId || !channelId) throw new Error("invalid_notification_config_scope");
  return new TextEncoder().encode(
    `alphaping:notification-config:v1:${workspaceId}:${channelId}`,
  );
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", decodeKey(keyHex), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function wrapNotificationConfig(
  config: Readonly<Record<string, unknown>>,
  keyHex: string,
  workspaceId: string,
  channelId: string,
): Promise<WrappedNotificationConfig> {
  const plaintext = new TextEncoder().encode(JSON.stringify(config));
  if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_CONFIG_BYTES) {
    throw new Error("invalid_notification_config_size");
  }
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: additionalData(workspaceId, channelId) },
    await importKey(keyHex),
    plaintext,
  );
  return { ciphertext, nonce: nonce.buffer };
}

export async function unwrapNotificationConfig(
  wrapped: WrappedNotificationConfig,
  keyHex: string,
  workspaceId: string,
  channelId: string,
): Promise<Readonly<Record<string, unknown>>> {
  if (wrapped.nonce.byteLength !== 12 || wrapped.ciphertext.byteLength > MAX_CONFIG_BYTES + 16) {
    throw new Error("invalid_notification_config_envelope");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: wrapped.nonce,
      additionalData: additionalData(workspaceId, channelId),
    },
    await importKey(keyHex),
    wrapped.ciphertext,
  );
  const value: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("invalid_notification_config");
  }
  return value as Readonly<Record<string, unknown>>;
}
