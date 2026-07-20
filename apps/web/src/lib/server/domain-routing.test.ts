import { describe, expect, it } from "vitest";

import {
  DomainRoutingConfigError,
  domainRouteAllowsPath,
  domainRouteForRequest,
  normalizeDomainHostname,
  parseDomainRoutes,
} from "./domain-routing.js";

const config = JSON.stringify({
  "Admin.Example.test": { kind: "admin", workspace: "operations" },
  "status.example.test": { kind: "status", workspace: "operations" },
  "edge.example.test": {
    kind: "machine",
    workspace: "operations",
    resource: "public-machine-1",
  },
  "api.example.test": {
    kind: "service",
    workspace: "operations",
    resource: "public-api",
  },
});

describe("domain routing", () => {
  it("normalizes hostnames and resolves each supported target", () => {
    expect(normalizeDomainHostname("Admin.Example.test.")).toBe("admin.example.test");
    expect(domainRouteForRequest(config, "ADMIN.EXAMPLE.TEST")).toEqual({
      kind: "admin",
      workspace: "operations",
    });
    expect(domainRouteForRequest(config, "edge.example.test")).toEqual({
      kind: "machine",
      workspace: "operations",
      resource: "public-machine-1",
    });
    expect(domainRouteForRequest(config, "unknown.example.test")).toBeNull();
  });

  it("keeps guest domains on their workspace public surface", () => {
    const route = domainRouteForRequest(config, "status.example.test");
    expect(route).not.toBeNull();
    if (!route) return;
    expect(domainRouteAllowsPath(route, "/")).toBe(true);
    expect(domainRouteAllowsPath(route, "/status/operations/machines")).toBe(true);
    expect(domainRouteAllowsPath(route, "/status/another-workspace")).toBe(false);
    expect(domainRouteAllowsPath(route, "/login")).toBe(false);
    expect(domainRouteAllowsPath(route, "/operations/admin")).toBe(false);
  });

  it("fails closed for malformed or ambiguous configuration", () => {
    for (const invalid of [
      "not-json",
      JSON.stringify({ "bad/path": { kind: "status", workspace: "operations" } }),
      JSON.stringify({
        "machine.example.test": { kind: "machine", workspace: "operations" },
      }),
      JSON.stringify({
        "status.example.test": { kind: "status", workspace: "UPPERCASE" },
      }),
    ]) {
      expect(() => parseDomainRoutes(invalid)).toThrow(DomainRoutingConfigError);
    }
  });
});
