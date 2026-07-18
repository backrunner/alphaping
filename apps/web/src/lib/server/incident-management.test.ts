import { describe, expect, it } from "vitest";

import { createIncident } from "./incident-management.js";

const unreachableDatabase = new Proxy(
  {},
  {
    get() {
      throw new Error("invalid incident input reached D1");
    },
  },
) as D1Database;

const validInput = {
  title: "API outage",
  summary: "The public API is unavailable.",
  severity: "major" as const,
  serviceIds: ["service-1"],
  impact: "down" as const,
  startsAt: Date.now(),
};

describe("incident input validation", () => {
  it("rejects more than 20 affected services before accessing D1", async () => {
    await expect(
      createIncident(unreachableDatabase, "operations", "user-1", {
        ...validInput,
        serviceIds: Array.from({ length: 21 }, (_, index) => `service-${index}`),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects fractional timestamps before accessing D1", async () => {
    await expect(
      createIncident(unreachableDatabase, "operations", "user-1", {
        ...validInput,
        startsAt: Date.now() + 0.5,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
