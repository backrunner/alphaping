import { describe, expect, it } from "vitest";

import { canAccessResource, type ResourceGrant } from "./index.js";

describe("resource authorization", () => {
  const grants: readonly ResourceGrant[] = [
    {
      resourceType: "machine",
      resourceId: "machine-1",
      capability: "manage",
      effect: "allow",
    },
  ];

  it("lets manage imply view", () => {
    expect(canAccessResource("member", grants, "machine", "machine-1", "view")).toBe(true);
  });

  it("gives explicit deny precedence", () => {
    expect(
      canAccessResource(
        "member",
        [
          ...grants,
          {
            resourceType: "machine",
            resourceId: "machine-1",
            capability: "view",
            effect: "deny",
          },
        ],
        "machine",
        "machine-1",
        "view",
      ),
    ).toBe(false);
  });

  it("lets administrators access the workspace", () => {
    expect(canAccessResource("admin", [], "service", "service-1", "manage")).toBe(true);
  });
});
