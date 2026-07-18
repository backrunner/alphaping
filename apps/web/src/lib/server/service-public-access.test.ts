import { error } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";

vi.mock("./monitoring-access.js", () => ({
  loadMonitoringAccess: vi.fn(async () => ({
    workspaceId: "workspace-1",
    defaultDashboardId: "dashboard-1",
    role: "member",
  })),
  requireAdmin: (access: { role: string }) => {
    if (access.role !== "admin") throw error(404, "Workspace not found");
  },
  requireResourceCapability: vi.fn(),
}));

import { setServicePublicAccess } from "./service-config.js";

const unreachableDatabase = new Proxy(
  {},
  {
    get() {
      throw new Error("non-admin public access change reached D1");
    },
  },
) as D1Database;

describe("service public access", () => {
  it("requires a workspace administrator before accessing D1 resources", async () => {
    await expect(
      setServicePublicAccess(unreachableDatabase, "operations", "member-1", "service-1", true),
    ).rejects.toMatchObject({ status: 404 });
  });
});
