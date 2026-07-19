import { describe, expect, it } from "vitest";

import { buildPublicStatusView, normalizePublicStatusServicePage } from "./public-status-view.js";

function service(index: number, state: "healthy" | "down" = "healthy") {
  return {
    name: `Service ${String(index).padStart(2, "0")}`,
    slug: `service-${String(index)}`,
    description: "",
    state,
    lastCheckedAt: null,
    lastTransitionAt: null,
    availability24hPermille: null,
    timeline: [],
  } as const;
}

const page = {
  workspace: { name: "Operations", slug: "operations" },
  dashboard: { name: "System status" },
  machines: [],
  services: Array.from({ length: 30 }, (_, index) =>
    service(index + 1, index === 29 ? "down" : "healthy"),
  ),
  incidents: [],
  announcements: [],
  updatedAt: null,
};

describe("public status view", () => {
  it("keeps the all-resource state while bounding each service page", () => {
    const first = buildPublicStatusView(page, 1);
    expect(first.services).toHaveLength(25);
    expect(first.services.at(-1)?.name).toBe("Service 25");
    expect(first.overallState).toBe("down");
    expect(first.servicePagination).toEqual({
      page: 1,
      pageSize: 25,
      pageCount: 2,
      total: 30,
      from: 1,
      to: 25,
    });

    const second = buildPublicStatusView(page, 2);
    expect(second.services).toHaveLength(5);
    expect(second.services.at(-1)?.name).toBe("Service 30");
    expect(second.servicePagination).toMatchObject({ page: 2, from: 26, to: 30 });
  });

  it("normalizes invalid and excessive page parameters", () => {
    expect(normalizePublicStatusServicePage(null)).toBe(1);
    expect(normalizePublicStatusServicePage("0")).toBe(1);
    expect(normalizePublicStatusServicePage("2.5")).toBe(1);
    expect(normalizePublicStatusServicePage("2")).toBe(2);
    expect(normalizePublicStatusServicePage("999")).toBe(8);
  });
});
