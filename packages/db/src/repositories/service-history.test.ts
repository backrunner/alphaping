import { describe, expect, it } from "vitest";

import {
  decodeStoredCheckHistoryPayload,
  ServiceHistoryDataError,
  ServiceHistoryRangeError,
  validateServiceHistoryRange,
} from "./service-history.js";

function payload(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

describe("service history bounds", () => {
  it("accepts the supported raw and rollup windows", () => {
    expect(() => validateServiceHistoryRange("raw", 0, 86_400_000)).not.toThrow();
    expect(() => validateServiceHistoryRange("5m", 0, 7 * 86_400_000)).not.toThrow();
    expect(() => validateServiceHistoryRange("1h", 0, 31 * 86_400_000)).not.toThrow();
  });

  it("rejects unbounded and invalid windows", () => {
    expect(() => validateServiceHistoryRange("raw", 0, 86_400_001)).toThrow(
      ServiceHistoryRangeError,
    );
    expect(() => validateServiceHistoryRange("5m", 2, 1)).toThrow(ServiceHistoryRangeError);
  });
});

describe("stored check history decoder", () => {
  it("decodes Cloudflare v1 and Agent v2 observations", () => {
    expect(
      decodeStoredCheckHistoryPayload(
        payload({
          v: 1,
          observedAt: 1_752_580_800_000,
          state: "healthy",
          latencyMs: 42,
          failureCode: null,
          failureSummary: null,
        }),
      ),
    ).toEqual([
      {
        kind: "raw",
        observedAt: 1_752_580_800_000,
        state: "healthy",
        latencyMs: 42,
        failureCode: null,
        failureSummary: null,
      },
    ]);
    expect(
      decodeStoredCheckHistoryPayload(
        payload({
          v: 2,
          samples: [
            {
              observedAtMs: 1_752_580_810_000,
              state: "down",
              latencyMs: null,
              failureCode: "timeout",
              failureSummary: "Probe timed out",
            },
          ],
        }),
      )[0]?.failureCode,
    ).toBe("timeout");
  });

  it("rejects malformed and unbounded payloads", () => {
    expect(() => decodeStoredCheckHistoryPayload(payload({ v: 2, samples: [] }))).toThrow(
      ServiceHistoryDataError,
    );
    expect(() =>
      decodeStoredCheckHistoryPayload(
        payload({
          v: 2,
          samples: Array.from({ length: 13 }, () => ({ observedAtMs: 1, state: "healthy" })),
        }),
      ),
    ).toThrow(ServiceHistoryDataError);
  });
});
