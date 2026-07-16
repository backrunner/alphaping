import { describe, expect, it } from "vitest";

import {
  decodeLiveMetricSample,
  decryptAgentLiveFrame,
  parseAgentLiveFrame,
  parseLiveViewerMessage,
} from "./live-frame.js";
import { deriveAgentLiveKey, encodeBase64Url } from "./live-ticket.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const SESSION = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const PREFIX = new Uint8Array([9, 8, 7, 6]);

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function varint(value: number): number[] {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    let current = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) current |= 0x80;
    bytes.push(current);
  } while (remaining > 0n);
  return bytes;
}

function metricSample(observedAt: number): Uint8Array {
  const values = [observedAt, 417, 2_048, 8_192, 4_096, 16_384, 512, 256, 65_536, 32_768];
  return new Uint8Array(
    values.flatMap((value, index) => [((index + 1) << 3) | 0, ...varint(value)]),
  );
}

async function encryptedFrame(machinePk = 7, sequence = 3, observedAt = 1_752_580_800_000) {
  const aad = new Uint8Array(44);
  aad.set([0x41, 0x50, 0x4c, 0x31], 0);
  aad.set(SESSION, 4);
  const view = new DataView(aad.buffer);
  view.setBigUint64(20, BigInt(machinePk), false);
  view.setBigUint64(28, BigInt(sequence), false);
  view.setBigUint64(36, BigInt(observedAt), false);
  const nonce = new Uint8Array(12);
  nonce.set(PREFIX, 0);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(sequence), false);
  const key = await deriveAgentLiveKey(SECRET, encodeBase64Url(SESSION));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce.buffer, additionalData: aad.buffer, tagLength: 128 },
      await crypto.subtle.importKey("raw", ownedBuffer(key), "AES-GCM", false, ["encrypt"]),
      ownedBuffer(metricSample(observedAt)),
    ),
  );
  const frame = new Uint8Array(48 + ciphertext.length);
  frame.set(aad, 0);
  new DataView(frame.buffer).setUint32(44, ciphertext.length, false);
  frame.set(ciphertext, 48);
  return frame;
}

describe("live frame contract", () => {
  it("decrypts an authenticated protobuf metric and emits a sanitized projection", async () => {
    const frame = parseAgentLiveFrame((await encryptedFrame()).buffer);
    const snapshot = await decryptAgentLiveFrame(frame, SECRET, {
      sessionId: encodeBase64Url(SESSION),
      noncePrefix: encodeBase64Url(PREFIX),
      machinePk: 7,
    });
    expect(snapshot).toEqual({
      type: "snapshot",
      topic: "machine:7",
      observedAt: 1_752_580_800_000,
      cpuPermille: 417,
      memoryUsedBytes: 2_048,
      memoryTotalBytes: 8_192,
      storageUsedBytes: 4_096,
      storageTotalBytes: 16_384,
      networkRxBps: 512,
      networkTxBps: 256,
      networkRxTotal: 65_536,
      networkTxTotal: 32_768,
    });
    expect(parseLiveViewerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rejects scope changes and ciphertext tampering", async () => {
    const valid = await encryptedFrame();
    const frame = parseAgentLiveFrame(valid.buffer);
    await expect(
      decryptAgentLiveFrame(frame, SECRET, {
        sessionId: encodeBase64Url(SESSION),
        noncePrefix: encodeBase64Url(PREFIX),
        machinePk: 8,
      }),
    ).rejects.toThrow("live_frame_scope_mismatch");
    const last = valid.length - 1;
    valid[last] = (valid[last] ?? 0) ^ 1;
    await expect(
      decryptAgentLiveFrame(parseAgentLiveFrame(valid.buffer), SECRET, {
        sessionId: encodeBase64Url(SESSION),
        noncePrefix: encodeBase64Url(PREFIX),
        machinePk: 7,
      }),
    ).rejects.toThrow();
  });

  it("bounds binary and protobuf inputs", async () => {
    const truncated = (await encryptedFrame()).slice(0, -1);
    expect(() => parseAgentLiveFrame(truncated.buffer)).toThrow("invalid_live_frame_length");
    expect(() => decodeLiveMetricSample(new Uint8Array([0x08, ...Array(10).fill(0x80)]))).toThrow(
      "invalid_live_protobuf_varint",
    );
    expect(() => parseLiveViewerMessage('{"type":"snapshot"}')).toThrow(
      "invalid_live_viewer_message",
    );
  });
});
