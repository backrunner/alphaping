import { describe, expect, it } from "vitest";

import { offlineTransitionAt } from "./machine-liveness.js";

const machine = {
  telemetry_pk: 7,
  offline_after_seconds: 150,
  maintenance_until: null,
};

describe("machine liveness", () => {
  it("uses the configured timeout boundary", () => {
    const latest = { machine_pk: 7, received_at: 1_000, state: "healthy" };
    expect(offlineTransitionAt(machine, latest, 150_999)).toBeNull();
    expect(offlineTransitionAt(machine, latest, 151_000)).toBe(151_000);
  });

  it("does not create repeated or maintenance-window transitions", () => {
    expect(
      offlineTransitionAt(
        machine,
        { machine_pk: 7, received_at: 1_000, state: "offline" },
        200_000,
      ),
    ).toBeNull();
    expect(
      offlineTransitionAt(
        { ...machine, maintenance_until: 250_000 },
        { machine_pk: 7, received_at: 1_000, state: "healthy" },
        200_000,
      ),
    ).toBeNull();
  });
});
