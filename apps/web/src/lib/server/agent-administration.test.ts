import { beforeEach, describe, expect, it, vi } from "vitest";

const monitoring = vi.hoisted(() => ({
  requireAdmin: vi.fn(() => {
    throw Object.assign(new Error("Workspace not found"), { status: 404 });
  }),
  requireResourceCapability: vi.fn(),
}));

vi.mock("./monitoring-access.js", () => ({
  loadMonitoringAccess: vi.fn(async () => ({ workspaceId: "workspace-1", role: "member" })),
  requireAdmin: monitoring.requireAdmin,
  requireResourceCapability: monitoring.requireResourceCapability,
}));

import { queueAgentCommand } from "./agent-commands.js";
import {
  listMachineEnrollmentTokens,
  regenerateMachineEnrollmentToken,
  revokeMachineEnrollmentToken,
} from "./resources.js";

const prepare = vi.fn(() => {
  throw new Error("database access must follow administrator authorization");
});
const database: D1Database = Object.assign(Object.create(null), { prepare });

describe("Agent administration authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an administrator before reading or changing enrollment tokens", async () => {
    const attempts = [
      listMachineEnrollmentTokens(database, "operations", "member-1", "machine-1"),
      revokeMachineEnrollmentToken(database, "operations", "member-1", "machine-1", "token-1"),
      regenerateMachineEnrollmentToken(
        database,
        "operations",
        "member-1",
        "0".repeat(64),
        "machine-1",
      ),
    ];

    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({ status: 404 });
    }
    expect(monitoring.requireAdmin).toHaveBeenCalledTimes(3);
    expect(monitoring.requireResourceCapability).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires an administrator before queuing an Agent command", async () => {
    await expect(
      queueAgentCommand(database, "operations", "member-1", "machine-1", {
        type: "check_update",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(monitoring.requireAdmin).toHaveBeenCalledOnce();
    expect(monitoring.requireResourceCapability).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("keeps runtime scans under machine management permission", async () => {
    monitoring.requireResourceCapability.mockImplementationOnce(() => {
      throw Object.assign(new Error("Resource not found"), { status: 404 });
    });

    await expect(
      queueAgentCommand(database, "operations", "member-1", "machine-1", {
        type: "redetect_runtimes",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(monitoring.requireAdmin).not.toHaveBeenCalled();
    expect(monitoring.requireResourceCapability).toHaveBeenCalledWith(
      expect.objectContaining({ role: "member" }),
      "machine",
      "machine-1",
      "manage",
    );
    expect(prepare).not.toHaveBeenCalled();
  });
});
