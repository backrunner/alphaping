import { describe, expect, it } from "vitest";

import { normalizeMachineConfiguration, parseMachineLabels } from "./resources.js";

const validConfiguration = {
  name: "edge-01",
  expectedHost: "192.0.2.10",
  description: "Singapore gateway",
  labels: "region=ap-southeast-1\nrole=gateway",
  samplingIntervalSeconds: 15,
  reportIntervalSeconds: 120,
  offlineAfterSeconds: 300,
  containersEnabled: true,
  maintenanceUntil: null,
};

function validationMessage(run: () => unknown): string {
  try {
    run();
  } catch (cause) {
    if (
      cause !== null &&
      typeof cause === "object" &&
      "body" in cause &&
      cause.body !== null &&
      typeof cause.body === "object" &&
      "message" in cause.body
    ) {
      return String(cause.body.message);
    }
    throw cause;
  }
  throw new Error("Expected machine configuration validation to fail");
}

describe("machine configuration validation", () => {
  it("normalizes labels and bounded collection settings", () => {
    expect(normalizeMachineConfiguration(validConfiguration)).toEqual({
      ...validConfiguration,
      labels: { region: "ap-southeast-1", role: "gateway" },
    });
  });

  it("requires key=value labels without duplicates", () => {
    expect(parseMachineLabels("region=sg, role=edge")).toEqual({ region: "sg", role: "edge" });
    expect(validationMessage(() => parseMachineLabels("region=sg\nregion=us"))).toContain(
      "duplicated",
    );
    expect(validationMessage(() => parseMachineLabels("unstructured"))).toContain("key=value");
  });

  it("rejects collection settings that cannot form complete reports", () => {
    expect(
      validationMessage(() =>
        normalizeMachineConfiguration({
          ...validConfiguration,
          samplingIntervalSeconds: 45,
          reportIntervalSeconds: 120,
        }),
      ),
    ).toContain("divisible");
    expect(
      validationMessage(() =>
        normalizeMachineConfiguration({
          ...validConfiguration,
          reportIntervalSeconds: 600,
          offlineAfterSeconds: 300,
        }),
      ),
    ).toContain("shorter");
  });
});
