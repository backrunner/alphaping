import { describe, expect, it } from "vitest";

import { floorToFiveMinuteBlock, floorToMinute, reportSlot } from "./telemetry.js";

describe("telemetry time slots", () => {
  it("maps each nominal minute to a fixed five-minute slot", () => {
    const block = Date.UTC(2026, 6, 15, 12, 35, 0);

    expect(floorToFiveMinuteBlock(block + 299_999)).toBe(block);
    expect([0, 1, 2, 3, 4].map((minute) => reportSlot(block + minute * 60_000))).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("removes seconds from a nominal report timestamp", () => {
    const observed = Date.UTC(2026, 6, 15, 12, 37, 42, 123);
    expect(floorToMinute(observed)).toBe(Date.UTC(2026, 6, 15, 12, 37, 0, 0));
  });
});
