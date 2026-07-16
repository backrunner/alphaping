import { describe, expect, it } from "vitest";

import { computeWorkspaceShellNavigation } from "./workspace-shell.js";

describe("workspace shell navigation", () => {
  const resources = [
    { resource_type: "machine" as const, resource_id: "machine-1" },
    { resource_type: "service" as const, resource_id: "service-1" },
  ];

  it("shows configured modules and administration to admins", () => {
    expect(computeWorkspaceShellNavigation("admin", [], resources)).toEqual({
      machines: true,
      services: true,
      developer: true,
    });
  });

  it("shows only resources granted to members", () => {
    expect(
      computeWorkspaceShellNavigation(
        "member",
        [
          {
            resourceType: "machine",
            resourceId: "machine-1",
            capability: "manage",
            effect: "allow",
          },
        ],
        resources,
      ),
    ).toEqual({ machines: true, services: false, developer: false });
  });

  it("honors explicit deny and hides empty modules", () => {
    expect(
      computeWorkspaceShellNavigation(
        "member",
        [
          {
            resourceType: "service",
            resourceId: "service-1",
            capability: "manage",
            effect: "allow",
          },
          {
            resourceType: "service",
            resourceId: "service-1",
            capability: "view",
            effect: "deny",
          },
        ],
        resources,
      ),
    ).toEqual({ machines: false, services: false, developer: false });
  });
});
