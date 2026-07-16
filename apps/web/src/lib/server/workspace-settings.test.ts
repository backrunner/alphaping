import { describe, expect, it } from "vitest";

import { estimateTelemetryStorageGb } from "./workspace-settings.js";

describe("retention storage estimate", () => {
  it("scales raw storage with resources and retention", () => {
    const baseline = estimateTelemetryStorageGb({
      machineCount: 30,
      checkCount: 30,
      retention: { rawDays: 7, rollup5mDays: 30, rollup1hDays: 365 },
    });
    const longerRaw = estimateTelemetryStorageGb({
      machineCount: 30,
      checkCount: 30,
      retention: { rawDays: 14, rollup5mDays: 30, rollup1hDays: 365 },
    });
    const largerWorkspace = estimateTelemetryStorageGb({
      machineCount: 100,
      checkCount: 100,
      retention: { rawDays: 7, rollup5mDays: 30, rollup1hDays: 365 },
    });

    expect(baseline).toBeGreaterThan(0);
    expect(longerRaw).toBeGreaterThan(baseline);
    expect(largerWorkspace).toBeGreaterThan(baseline * 3);
  });
});
