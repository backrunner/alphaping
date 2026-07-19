import { describe, expect, it } from "vitest";

import { normalizePublicStatusServicePage } from "./public-status-view.js";

describe("public status view", () => {
  it("normalizes invalid and excessive page parameters", () => {
    expect(normalizePublicStatusServicePage(null)).toBe(1);
    expect(normalizePublicStatusServicePage("0")).toBe(1);
    expect(normalizePublicStatusServicePage("2.5")).toBe(1);
    expect(normalizePublicStatusServicePage("2")).toBe(2);
    expect(normalizePublicStatusServicePage("999")).toBe(8);
  });
});
