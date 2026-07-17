import { describe, expect, it } from "vitest";

import { MachineHistoryRangeError, validateMachineHistoryRange } from "./machine-history.js";
import { parseProbeTarget } from "./machine-probes.js";
import { parseContainerInventory, resolveLastMachineError } from "./machines.js";

describe("machine history range", () => {
  it("allows the bounded dashboard ranges", () => {
    expect(() => validateMachineHistoryRange("5m", 0, 7 * 86_400_000)).not.toThrow();
    expect(() => validateMachineHistoryRange("1h", 0, 31 * 86_400_000)).not.toThrow();
  });

  it("rejects scans beyond the fixed resolution budget", () => {
    expect(() => validateMachineHistoryRange("5m", 0, 7 * 86_400_000 + 1)).toThrow(
      MachineHistoryRangeError,
    );
    expect(() => validateMachineHistoryRange("1h", 10, 9)).toThrow(MachineHistoryRangeError);
    expect(() => validateMachineHistoryRange("1h", Number.NaN, 10)).toThrow(
      MachineHistoryRangeError,
    );
  });
});

describe("container inventory projection", () => {
  it("accepts a bounded current snapshot", () => {
    const inventory = parseContainerInventory(
      JSON.stringify({
        observedAt: 1_752_574_830_123,
        runtimes: [
          {
            kind: "docker",
            instance: "default",
            availability: "available",
            version: "28.3.2",
            detailCode: "",
          },
        ],
        containers: [
          {
            id: "0123456789abcdef0123456789abcdef",
            runtime: "docker",
            runtimeInstance: "default",
            name: "api",
            image: "example/api:1",
            state: "running",
            health: "healthy",
            startedAt: 1_752_574_000_000,
            restartCount: 1,
            cpuPermille: 125,
            memoryUsedBytes: 1_024,
            memoryLimitBytes: 2_048,
            networkRxBps: 10,
            networkTxBps: 20,
            ports: [{ privatePort: 8080, publicPort: 443, protocol: "tcp" }],
          },
        ],
      }),
    );
    expect(inventory?.containers[0]?.name).toBe("api");
    expect(inventory?.runtimes[0]?.availability).toBe("available");
  });

  it("rejects malformed or unbounded snapshots", () => {
    expect(parseContainerInventory("not-json")).toBeNull();
    expect(
      parseContainerInventory(
        JSON.stringify({
          observedAt: 1,
          runtimes: [],
          containers: Array.from({ length: 65 }, () => ({})),
        }),
      ),
    ).toBeNull();
  });
});

describe("machine diagnostics", () => {
  it("selects the newest bounded Agent or runtime error", () => {
    const inventory = parseContainerInventory(
      JSON.stringify({
        observedAt: 20_000,
        runtimes: [
          {
            kind: "colima-docker",
            instance: "default",
            availability: "stopped",
            version: "",
            detailCode: "profile_stopped",
          },
        ],
        containers: [],
      }),
    );
    expect(
      resolveLastMachineError(
        [
          {
            type: "check_update",
            state: "failed",
            result_code: "metadata_expired",
            created_at: 10_000,
            completed_at: 15_000,
          },
        ],
        inventory,
      ),
    ).toMatchObject({
      code: "profile_stopped",
      source: "container-runtime",
      occurredAt: 20_000,
    });
  });
});

describe("probe target projection", () => {
  it("omits query credentials while keeping an operational target", () => {
    expect(
      parseProbeTarget(
        "http",
        JSON.stringify({ url: "https://api.example.com/health?token=private" }),
      ),
    ).toBe("https://api.example.com/health");
    expect(parseProbeTarget("tcp", JSON.stringify({ hostname: "db.internal", port: 5432 }))).toBe(
      "db.internal:5432",
    );
  });
});
