import { describe, expect, it } from "vitest";

import { dueSlot, isDue } from "./schedule.js";

describe("check scheduling", () => {
  it("uses stable interval and phase slots", () => {
    expect(dueSlot(185_000, 60, 15)).toBe(135);
    expect(isDue(185_000, 60, 15, 135)).toBe(false);
    expect(isDue(196_000, 60, 15, 135)).toBe(true);
  });
});
