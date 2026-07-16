import { describe, expect, it } from "vitest";

import { permissionFromGrants } from "./workspace-access.js";

describe("resource permission editor", () => {
  const grant = (capability: "view" | "manage", effect: "allow" | "deny") => ({
    capability,
    effect,
    resource_type: "machine" as const,
    resource_id: "machine-1",
  });

  it("maps stored grants into one unambiguous editor state", () => {
    expect(permissionFromGrants([])).toBe("none");
    expect(permissionFromGrants([grant("view", "allow")])).toBe("view");
    expect(permissionFromGrants([grant("manage", "allow")])).toBe("manage");
  });

  it("gives an explicit deny precedence over allows", () => {
    expect(permissionFromGrants([grant("manage", "allow"), grant("view", "deny")])).toBe("deny");
  });

  it("maps container grants with the same precedence rules", () => {
    expect(
      permissionFromGrants([
        {
          capability: "manage",
          effect: "allow",
          resource_type: "container",
          resource_id: "container-1",
        },
      ]),
    ).toBe("manage");
  });
});
