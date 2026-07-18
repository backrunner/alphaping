import { describe, expect, it } from "vitest";

import { canAccessContainer, canAccessResource, type ResourceGrant } from "./index.js";

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

  it("does not let manage bypass a view deny", () => {
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
        "manage",
      ),
    ).toBe(false);
  });

  it("keeps view access when only manage is denied", () => {
    expect(
      canAccessResource(
        "member",
        [
          {
            resourceType: "machine",
            resourceId: "machine-1",
            capability: "view",
            effect: "allow",
          },
          {
            resourceType: "machine",
            resourceId: "machine-1",
            capability: "manage",
            effect: "deny",
          },
        ],
        "machine",
        "machine-1",
        "view",
      ),
    ).toBe(true);
  });

  it("lets administrators access the workspace", () => {
    expect(canAccessResource("admin", [], "service", "service-1", "manage")).toBe(true);
  });

  it("inherits machine access and lets a container deny win", () => {
    expect(canAccessContainer("member", grants, "machine-1", "container-1", "view")).toBe(true);
    expect(
      canAccessContainer(
        "member",
        [
          ...grants,
          {
            resourceType: "container",
            resourceId: "container-1",
            capability: "view",
            effect: "deny",
          },
        ],
        "machine-1",
        "container-1",
        "view",
      ),
    ).toBe(false);
  });

  it("does not let inherited machine management bypass a container view deny", () => {
    expect(
      canAccessContainer(
        "member",
        [
          ...grants,
          {
            resourceType: "container",
            resourceId: "container-1",
            capability: "view",
            effect: "deny",
          },
        ],
        "machine-1",
        "container-1",
        "manage",
      ),
    ).toBe(false);
  });
});
