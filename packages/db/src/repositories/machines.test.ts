import { describe, expect, it } from "vitest";

import { MachineHistoryRangeError, validateMachineHistoryRange } from "./machine-history.js";

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
