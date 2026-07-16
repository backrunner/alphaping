import { describe, expect, it } from "vitest";

import { requiresPrivateCaching } from "./hooks.server.js";

describe("private response caching", () => {
  it("keeps authenticated and credential-bearing routes out of shared caches", () => {
    expect(requiresPrivateCaching("/operations", true)).toBe(true);
    expect(requiresPrivateCaching("/invite/token", false)).toBe(true);
    expect(requiresPrivateCaching("/login", false)).toBe(true);
    expect(requiresPrivateCaching("/setup", false)).toBe(true);
  });

  it("allows public status responses to define their own caching", () => {
    expect(requiresPrivateCaching("/status/operations", false)).toBe(false);
  });
});
