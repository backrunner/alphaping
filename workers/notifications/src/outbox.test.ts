import { describe, expect, it } from "vitest";

import { retryDelayMs } from "./outbox.js";

describe("notification retry schedule", () => {
  it("uses bounded exponential backoff", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(retryDelayMs)).toEqual([
      60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000,
    ]);
  });
});
