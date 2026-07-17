import { describe, expect, it } from "vitest";

import { decodeCompressedMachineSamples } from "./machine-report.js";

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
  const values = [
    observedAt,
    417,
    2_048,
    8_192,
    4_096,
    16_384,
    512,
    256,
    65_536,
    32_768,
    1_250,
    86_400,
  ];
  return new Uint8Array(
    values.flatMap((value, index) => [((index + 1) << 3) | 0, ...varint(value)]),
  );
}

async function deflate(bytes: Uint8Array): Promise<ArrayBuffer> {
  const owned = Uint8Array.from(bytes).buffer;
  return new Response(
    new Blob([owned]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer();
}

describe("compressed machine report decoder", () => {
  it("restores bounded protobuf metric samples", async () => {
    const sample = metricSample(1_752_580_800_000);
    const report = new Uint8Array([0x2a, ...varint(sample.byteLength), ...sample]);
    await expect(decodeCompressedMachineSamples(await deflate(report))).resolves.toEqual([
      {
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
        load1mMilli: 1_250,
        uptimeSeconds: 86_400,
      },
    ]);
  });

  it("rejects empty, malformed, and oversized compressed inputs", async () => {
    await expect(decodeCompressedMachineSamples(new ArrayBuffer(0))).rejects.toThrow(
      "invalid_machine_report_size",
    );
    await expect(
      decodeCompressedMachineSamples(await deflate(new Uint8Array([0x2a, 0x02, 0x08]))),
    ).rejects.toThrow("invalid_machine_report_field");
    await expect(decodeCompressedMachineSamples(new ArrayBuffer(64 * 1024 + 1))).rejects.toThrow(
      "invalid_machine_report_size",
    );
  });
});
