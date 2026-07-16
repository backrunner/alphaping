import { decodeBase64Url, deriveAgentLiveKey } from "./live-ticket.js";

export const MAX_LIVE_FRAME_BYTES = 16 * 1024;
export const LIVE_FRESHNESS_MS = 20_000;

const FRAME_HEADER_BYTES = 48;
const AUTHENTICATED_HEADER_BYTES = 44;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
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
}

function safeNumber(value: bigint): number {
  if (value > MAX_SAFE_BIGINT) throw new Error("live_integer_out_of_range");
  return Number(value);
}

function readUnsigned64(view: DataView, offset: number): number {
  return safeNumber(view.getBigUint64(offset, false));
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

function readVarint(bytes: Uint8Array, start: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  for (let offset = start; offset < bytes.length && offset < start + 10; offset += 1) {
    const current = bytes[offset];
    if (current === undefined) break;
    value |= BigInt(current & 0x7f) << shift;
    if ((current & 0x80) === 0) return { value, next: offset + 1 };
    shift += 7n;
  }
  throw new Error("invalid_live_protobuf_varint");
}

function skipField(bytes: Uint8Array, offset: number, wireType: number): number {
  if (wireType === 0) return readVarint(bytes, offset).next;
  if (wireType === 1) {
    if (offset + 8 > bytes.length) throw new Error("invalid_live_protobuf_field");
    return offset + 8;
  }
  if (wireType === 2) {
    const length = readVarint(bytes, offset);
    const next = length.next + safeNumber(length.value);
    if (next > bytes.length) throw new Error("invalid_live_protobuf_field");
    return next;
  }
  if (wireType === 5) {
    if (offset + 4 > bytes.length) throw new Error("invalid_live_protobuf_field");
    return offset + 4;
  }
  throw new Error("invalid_live_protobuf_wire_type");
}

export function decodeLiveMetricSample(
  bytes: Uint8Array,
): Omit<LiveViewerSnapshot, "type" | "topic"> {
  if (bytes.byteLength === 0 || bytes.byteLength > 2_048) {
    throw new Error("invalid_live_metric_size");
  }
  const values = Array.from({ length: 10 }, () => 0);
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x07n);
    if (field >= 1 && field <= 10) {
      if (wireType !== 0) throw new Error("invalid_live_metric_wire_type");
      const decoded = readVarint(bytes, offset);
      values[field - 1] = safeNumber(decoded.value);
      offset = decoded.next;
    } else {
      offset = skipField(bytes, offset, wireType);
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
  };
}
