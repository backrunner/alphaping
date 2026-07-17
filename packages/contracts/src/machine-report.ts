import { readProtobufVarint, safeProtobufNumber, skipProtobufField } from "./protobuf.js";

const MAX_COMPRESSED_BYTES = 64 * 1024;
const MAX_DECOMPRESSED_BYTES = 256 * 1024;

export interface RawMachineMetricSample {
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

async function inflateZlib(value: ArrayBuffer): Promise<Uint8Array> {
  if (value.byteLength === 0 || value.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error("invalid_machine_report_size");
  }
  const reader = new Blob([value])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_DECOMPRESSED_BYTES) {
        await reader.cancel("machine_report_too_large");
        throw new Error("machine_report_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const decoded = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoded;
}

function decodeMetricSample(bytes: Uint8Array): RawMachineMetricSample {
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
      if (wireType !== 0) throw new Error("invalid_machine_metric_wire_type");
      const decoded = readProtobufVarint(bytes, offset);
      values[field - 1] = safeProtobufNumber(decoded.value);
      offset = decoded.next;
    } else {
      offset = skipProtobufField(bytes, offset, wireType);
    }
  }
  const observedAt = values[0] ?? 0;
  const cpuPermille = values[1] ?? 0;
  const memoryUsedBytes = values[2] ?? 0;
  const memoryTotalBytes = values[3] ?? 0;
  const storageUsedBytes = values[4] ?? 0;
  const storageTotalBytes = values[5] ?? 0;
  if (
    observedAt <= 0 ||
    cpuPermille > 1_000 ||
    (memoryTotalBytes > 0 && memoryUsedBytes > memoryTotalBytes) ||
    (storageTotalBytes > 0 && storageUsedBytes > storageTotalBytes)
  ) {
    throw new Error("invalid_machine_metric_value");
  }
  return {
    observedAt,
    cpuPermille,
    memoryUsedBytes,
    memoryTotalBytes,
    storageUsedBytes,
    storageTotalBytes,
    networkRxBps: values[6] ?? 0,
    networkTxBps: values[7] ?? 0,
    networkRxTotal: values[8] ?? 0,
    networkTxTotal: values[9] ?? 0,
    load1mMilli: values[10] ?? null,
    uptimeSeconds: values[11] ?? null,
  };
}

export async function decodeCompressedMachineSamples(
  value: ArrayBuffer,
): Promise<readonly RawMachineMetricSample[]> {
  const bytes = await inflateZlib(value);
  const samples: RawMachineMetricSample[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readProtobufVarint(bytes, offset);
    offset = tag.next;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x07n);
    if (field === 5) {
      if (wireType !== 2) throw new Error("invalid_machine_report_wire_type");
      const length = readProtobufVarint(bytes, offset);
      const end = length.next + safeProtobufNumber(length.value);
      if (end > bytes.length) throw new Error("invalid_machine_report_field");
      samples.push(decodeMetricSample(bytes.subarray(length.next, end)));
      if (samples.length > 6) throw new Error("machine_report_sample_limit");
      offset = end;
    } else {
      offset = skipProtobufField(bytes, offset, wireType);
    }
  }
  if (samples.length === 0) throw new Error("machine_report_samples_missing");
  return samples;
}
