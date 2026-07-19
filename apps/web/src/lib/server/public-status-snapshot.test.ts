import { describe, expect, it } from "vitest";

import { buildPublicStatusView } from "$lib/public-status-view";

import {
  buildPublicStatusSnapshot,
  parsePublicStatusSnapshot,
  PUBLIC_STATUS_SNAPSHOT_TTL_SECONDS,
  publicStatusSnapshotKey,
} from "./public-status-snapshot.js";

const now = 1_752_580_800_000;
const sourcePage = {
  workspace: { name: "Operations", slug: "operations", internalId: "private-workspace" },
  dashboard: { name: "System status", token: "private-token" },
  machines: [],
  services: [],
  incidents: [],
  announcements: [],
  updatedAt: now - 1_000,
};
const page = buildPublicStatusView(sourcePage, 1);

describe("public status snapshot", () => {
  it("uses a versioned origin and workspace-scoped cache key", () => {
    expect(publicStatusSnapshotKey("https://status.example.test", "operations", 3).url).toBe(
      "https://status.example.test/__alphaping_cache__/public-status/v2/operations/services/3",
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
        overallState: "unknown",
        servicePagination: {
          page: 1,
          pageSize: 25,
          pageCount: 1,
          total: 0,
          from: 0,
          to: 0,
        },
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

  it("does not extend announcement visibility while serving a stale snapshot", () => {
    const expiringPage = {
      ...page,
      announcements: [
        {
          id: "maintenance-1",
          title: "Scheduled maintenance",
          body: "Maintenance is complete.",
          severity: "maintenance" as const,
          startsAt: now - 60_000,
          expiresAt: now + 1_000,
        },
      ],
    };
    const serialized = JSON.stringify(buildPublicStatusSnapshot(expiringPage, now));

    expect(
      parsePublicStatusSnapshot(serialized, "operations", now)?.page.announcements,
    ).toHaveLength(1);
    expect(
      parsePublicStatusSnapshot(serialized, "operations", now + 1_000)?.page.announcements,
    ).toEqual([]);
  });
});
