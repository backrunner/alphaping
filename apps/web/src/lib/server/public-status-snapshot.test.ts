import { describe, expect, it } from "vitest";

import {
  buildPublicStatusSnapshot,
  parsePublicStatusSnapshot,
  PUBLIC_STATUS_SNAPSHOT_TTL_SECONDS,
  publicStatusSnapshotKey,
} from "./public-status-snapshot.js";

const now = 1_752_580_800_000;
const page = {
  workspace: { name: "Operations", slug: "operations", internalId: "private-workspace" },
  dashboard: { name: "System status", token: "private-token" },
  machines: [],
  services: [],
  incidents: [],
  announcements: [],
  updatedAt: now - 1_000,
};

describe("public status snapshot", () => {
  it("uses a versioned origin and workspace-scoped cache key", () => {
    expect(publicStatusSnapshotKey("https://status.example.test", "operations").url).toBe(
      "https://status.example.test/__alphaping_cache__/public-status/v1/operations",
    );
  });

  it("round trips only the explicit public projection", () => {
    const snapshot = buildPublicStatusSnapshot(page, now);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("private-workspace");
    expect(serialized).not.toContain("private-token");
    expect(parsePublicStatusSnapshot(serialized, "operations", now)).toEqual({
      page: {
        workspace: { name: "Operations", slug: "operations" },
        dashboard: { name: "System status" },
        machines: [],
        services: [],
        incidents: [],
        announcements: [],
        updatedAt: now - 1_000,
      },
      cachedAt: now,
    });
  });

  it("rejects cross-workspace, future, and expired snapshots", () => {
    const serialized = JSON.stringify(buildPublicStatusSnapshot(page, now));
    expect(parsePublicStatusSnapshot(serialized, "other", now)).toBeNull();
    expect(parsePublicStatusSnapshot(serialized, "operations", now - 60_001)).toBeNull();
    expect(
      parsePublicStatusSnapshot(
        serialized,
        "operations",
        now + PUBLIC_STATUS_SNAPSHOT_TTL_SECONDS * 1_000 + 1,
      ),
    ).toBeNull();
  });
});
