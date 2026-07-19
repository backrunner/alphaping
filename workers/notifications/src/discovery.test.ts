import { describe, expect, it } from "vitest";

import { dimensionForEvent } from "./discovery.js";

describe("notification event dimensions", () => {
  it("routes healthy transitions to recovery channels", () => {
    expect(dimensionForEvent({ current_state: "healthy", reason_code: "check_healthy" })).toBe(
      "recovery",
    );
  });

  it("routes machine threshold transitions to resource channels", () => {
    expect(
      dimensionForEvent({ current_state: "degraded", reason_code: "resource_threshold" }),
    ).toBe("resource");
  });

  it("routes offline and check failures to availability channels", () => {
    expect(dimensionForEvent({ current_state: "offline", reason_code: "report_timeout" })).toBe(
      "availability",
    );
    expect(dimensionForEvent({ current_state: "down", reason_code: "check_down" })).toBe(
      "availability",
    );
  });
});
