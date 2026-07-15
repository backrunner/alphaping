import { describe, expect, it } from "vitest";

import { projectPublicStatusService } from "./public-status.js";

describe("public status projection", () => {
  it("contains only public service status fields", () => {
    const projected = projectPublicStatusService({
      service: {
        id: "service-internal-id",
        telemetry_pk: 7,
        name: "Public API",
        slug: "public-api",
        description: "Customer API",
        projection_profile: "detailed",
      },
      latest: {
        service_pk: 7,
        state: "healthy",
        last_transition_at: 100,
      },
      lastCheckedAt: 200,
      buckets: [],
      now: 300,
    });
    expect(Object.keys(projected).sort()).toEqual([
      "availability24hPermille",
      "description",
      "lastCheckedAt",
      "lastTransitionAt",
      "name",
      "slug",
      "state",
      "timeline",
    ]);
    expect(JSON.stringify(projected)).not.toContain("service-internal-id");
    for (const sensitive of ["url", "header", "payload", "agent", "diagnostic", "secret"]) {
      expect(JSON.stringify(projected).toLowerCase()).not.toContain(sensitive);
    }
  });
});
