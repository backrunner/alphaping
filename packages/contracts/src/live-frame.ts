import { decodeBase64Url, deriveAgentLiveKey } from "./live-ticket.js";
import { readProtobufVarint, safeProtobufNumber, skipProtobufField } from "./protobuf.js";

export const MAX_LIVE_FRAME_BYTES = 16 * 1024;
export const LIVE_FRESHNESS_MS = 20_000;

const FRAME_HEADER_BYTES = 48;
const AUTHENTICATED_HEADER_BYTES = 44;
const LIVE_MAGIC = new Uint8Array([0x41, 0x50, 0x4c, 0x31]);

export interface AgentLiveFrameHeader {
  sessionId: Uint8Array;
  machinePk: number;
  sequence: number;
  observedAt: number;
  aad: Uint8Array;
  ciphertext: Uint8Array;
}

export interface LiveViewerSnapshot {
  type: "snapshot";
  topic: string;
  observedAt: number;
  cpuPermille: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  storageUsedBytes: number;
  storageTotalBytes: number;
  networkRxBps: number;
  networkTxBps: number;
  networkRxTotal: number;
  networkTxTotal: number;
  load1mMilli: number | null;
  uptimeSeconds: number | null;
}

function readUnsigned64(view: DataView, offset: number): number {
  return safeProtobufNumber(view.getBigUint64(offset, false));
}

export function parseAgentLiveFrame(message: ArrayBuffer): AgentLiveFrameHeader {
  const bytes = new Uint8Array(message);
  if (bytes.byteLength < FRAME_HEADER_BYTES + 16 || bytes.byteLength > MAX_LIVE_FRAME_BYTES) {
    throw new Error("invalid_live_frame_size");
  }
  if (!LIVE_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error("invalid_live_frame_magic");
  }
  const view = new DataView(message);
  const ciphertextBytes = view.getUint32(44, false);
  if (ciphertextBytes < 16 || FRAME_HEADER_BYTES + ciphertextBytes !== bytes.byteLength) {
    throw new Error("invalid_live_frame_length");
  }
  return {
    sessionId: bytes.slice(4, 20),
    machinePk: readUnsigned64(view, 20),
    sequence: readUnsigned64(view, 28),
    observedAt: readUnsigned64(view, 36),
    aad: bytes.slice(0, AUTHENTICATED_HEADER_BYTES),
    ciphertext: bytes.slice(FRAME_HEADER_BYTES),
  };
}

export function decodeLiveMetricSample(
  bytes: Uint8Array,
): Omit<LiveViewerSnapshot, "type" | "topic"> {
  if (bytes.byteLength === 0 || bytes.byteLength > 2_048) {
    throw new Error("invalid_live_metric_size");
  }
  const values: Array<number | null> = Array.from({ length: 12 }, (_, index) =>
    index < 10 ? 0 : null,
  );
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readProtobufVarint(bytes, offset);
    offset = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x07n);
    if (field >= 1 && field <= 12) {
      if (wireType !== 0) throw new Error("invalid_live_metric_wire_type");
      const decoded = readProtobufVarint(bytes, offset);
      values[field - 1] = safeProtobufNumber(decoded.value);
      offset = decoded.next;
    } else {
      offset = skipProtobufField(bytes, offset, wireType);
    }
  }
  const observedAt = values[0] ?? 0;
  const cpuPermille = values[1] ?? 0;
  if (observedAt <= 0 || cpuPermille > 1_000) throw new Error("invalid_live_metric_value");
  return {
    observedAt,
    cpuPermille,
    memoryUsedBytes: values[2] ?? 0,
    memoryTotalBytes: values[3] ?? 0,
    storageUsedBytes: values[4] ?? 0,
    storageTotalBytes: values[5] ?? 0,
    networkRxBps: values[6] ?? 0,
    networkTxBps: values[7] ?? 0,
    networkRxTotal: values[8] ?? 0,
    networkTxTotal: values[9] ?? 0,
    load1mMilli: values[10] ?? null,
    uptimeSeconds: values[11] ?? null,
  };
}

function nonce(prefix: Uint8Array, sequence: number): Uint8Array {
  if (prefix.byteLength !== 4 || !Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("invalid_live_nonce");
  }
  const value = new Uint8Array(12);
  value.set(prefix, 0);
  new DataView(value.buffer).setBigUint64(4, BigInt(sequence), false);
  return value;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function decryptAgentLiveFrame(
  frame: AgentLiveFrameHeader,
  secret: string,
  expected: { sessionId: string; noncePrefix: string; machinePk: number },
): Promise<LiveViewerSnapshot> {
  const expectedSession = decodeBase64Url(expected.sessionId, 16);
  if (
    expectedSession.byteLength !== 16 ||
    !expectedSession.every((value, index) => frame.sessionId[index] === value) ||
    frame.machinePk !== expected.machinePk
  ) {
    throw new Error("live_frame_scope_mismatch");
  }
  const key = await deriveAgentLiveKey(secret, expected.sessionId);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(nonce(decodeBase64Url(expected.noncePrefix, 4), frame.sequence)),
      additionalData: ownedBuffer(frame.aad),
      tagLength: 128,
    },
    await crypto.subtle.importKey("raw", ownedBuffer(key), "AES-GCM", false, ["decrypt"]),
    ownedBuffer(frame.ciphertext),
  );
  const sample = decodeLiveMetricSample(new Uint8Array(plaintext));
  if (sample.observedAt !== frame.observedAt) throw new Error("live_frame_time_mismatch");
  return { type: "snapshot", topic: `machine:${frame.machinePk}`, ...sample };
}

function isSafeMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function metricValue(data: Readonly<Record<string, unknown>>, key: string): number {
  const value = data[key];
  if (!isSafeMetric(value)) throw new Error("invalid_live_viewer_message");
  return value;
}

function optionalMetricValue(data: Readonly<Record<string, unknown>>, key: string): number | null {
  return data[key] === null ? null : metricValue(data, key);
}

export function parseLiveViewerMessage(value: string): LiveViewerSnapshot {
  if (value.length > 4_096) throw new Error("invalid_live_viewer_message");
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid_live_viewer_message");
  }
  const data = parsed as Readonly<Record<string, unknown>>;
  const observedAt = metricValue(data, "observedAt");
  const cpuPermille = metricValue(data, "cpuPermille");
  const memoryUsedBytes = metricValue(data, "memoryUsedBytes");
  const memoryTotalBytes = metricValue(data, "memoryTotalBytes");
  const storageUsedBytes = metricValue(data, "storageUsedBytes");
  const storageTotalBytes = metricValue(data, "storageTotalBytes");
  const networkRxBps = metricValue(data, "networkRxBps");
  const networkTxBps = metricValue(data, "networkTxBps");
  const networkRxTotal = metricValue(data, "networkRxTotal");
  const networkTxTotal = metricValue(data, "networkTxTotal");
  const load1mMilli = optionalMetricValue(data, "load1mMilli");
  const uptimeSeconds = optionalMetricValue(data, "uptimeSeconds");
  if (
    data.type !== "snapshot" ||
    typeof data.topic !== "string" ||
    !/^machine:[1-9][0-9]{0,19}$/.test(data.topic) ||
    cpuPermille > 1_000
  ) {
    throw new Error("invalid_live_viewer_message");
  }
  return {
    type: "snapshot",
    topic: data.topic,
    observedAt,
    cpuPermille,
    memoryUsedBytes,
    memoryTotalBytes,
    storageUsedBytes,
    storageTotalBytes,
    networkRxBps,
    networkTxBps,
    networkRxTotal,
    networkTxTotal,
    load1mMilli,
    uptimeSeconds,
  };
}
