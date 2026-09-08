import { defaultSiteAppearance } from "@alphaping/contracts";
import { loadSiteAppearance, updateSiteAppearance } from "./site-appearance.js";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  estimateTelemetryStorageGb,
  loadWorkspaceSettingsPanel,
  updateDashboardVisibility,
  updateResourcePublicPolicy,
  updateRetentionSettings,
} from "./workspace-settings.js";

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "control-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, slug TEXT NOT NULL,
        default_dashboard_id TEXT NOT NULL, default_sampling_interval_seconds INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE resource_grants (
        workspace_id TEXT NOT NULL, subject_user_id TEXT NOT NULL, resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL, capability TEXT NOT NULL, effect TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE dashboards (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, visibility TEXT NOT NULL,
        updated_at INTEGER NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE dashboard_resources (
        dashboard_id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL, public_override TEXT NOT NULL,
        PRIMARY KEY (dashboard_id, resource_type, resource_id)
      )`,
    ),
    database.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE containers (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, enabled INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE resource_public_policies (
        workspace_id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
        effect TEXT NOT NULL, projection_profile TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, resource_type, resource_id)
      )`,
    ),
    database.prepare(
      `CREATE TABLE retention_policies (
        workspace_id TEXT PRIMARY KEY, raw_days INTEGER NOT NULL, rollup_5m_days INTEGER NOT NULL,
        rollup_1h_days INTEGER NOT NULL, event_days INTEGER NOT NULL, audit_log_days INTEGER NOT NULL,
        expired_announcement_grace_days INTEGER NOT NULL, soft_delete_grace_days INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
        before_digest TEXT, after_digest TEXT, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 1, 'operations', 'dashboard-1', 60, NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES ('workspace-1', 'admin-1', 'admin', 'active')`,
    ),
    database.prepare(
      `INSERT INTO dashboards VALUES ('dashboard-1', 'workspace-1', 'private', 1, NULL)`,
    ),
    database.prepare(`INSERT INTO machines VALUES ('machine-1', 'workspace-1', 'Edge', NULL)`),
    database.prepare(
      `INSERT INTO retention_policies VALUES ('workspace-1', 7, 30, 365, 365, 365, 7, 7, 1)`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

function mutateBeforeBatch(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property !== "batch") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async <T>(statements: D1PreparedStatement[]) => {
        await target
          .prepare(
            `UPDATE memberships SET role = 'member'
             WHERE workspace_id = 'workspace-1' AND user_id = 'admin-1'`,
          )
          .run();
        return target.batch<T>(statements);
      };
    },
  });
}

async function expectNoAuditRows(): Promise<void> {
  await expect(
    database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>(),
  ).resolves.toEqual({ count: 0 });
}

describe("workspace settings authorization", () => {
  it("rejects dashboard visibility after the actor loses administrator access", async () => {
    await expect(
      updateDashboardVisibility(mutateBeforeBatch(database), "operations", "admin-1", "public"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT visibility FROM dashboards WHERE id = 'dashboard-1'").first(),
    ).resolves.toEqual({ visibility: "private" });
    await expectNoAuditRows();
  });

  it("rejects a public policy after the actor loses administrator access", async () => {
    await expect(
      updateResourcePublicPolicy(mutateBeforeBatch(database), "operations", "admin-1", {
        resourceType: "machine",
        resourceId: "machine-1",
        effect: "allow",
        projectionProfile: "detailed",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM resource_public_policies").first(),
    ).resolves.toEqual({ count: 0 });
    await expectNoAuditRows();
  });

  it("rejects retention changes after the actor loses administrator access", async () => {
    await expect(
      updateRetentionSettings(mutateBeforeBatch(database), "operations", "admin-1", {
        rawDays: 14,
        rollup5mDays: 30,
        rollup1hDays: 365,
        eventDays: 365,
        auditLogDays: 365,
        expiredAnnouncementGraceDays: 7,
        softDeleteGraceDays: 7,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      database
        .prepare("SELECT raw_days FROM retention_policies WHERE workspace_id = 'workspace-1'")
        .first(),
    ).resolves.toEqual({ raw_days: 7 });
    await expectNoAuditRows();
  });
});

describe("workspace public resource pagination", () => {
  it("keeps every resource reachable without a fixed result cap", async () => {
    await database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 2 UNION ALL SELECT value + 1 FROM sequence WHERE value < 75
         )
         INSERT INTO machines (id, workspace_id, name, deleted_at)
         SELECT printf('machine-%03d', value), 'workspace-1', printf('Machine %03d', value), NULL
         FROM sequence`,
      )
      .run();

    const firstPage = await loadWorkspaceSettingsPanel(database, "operations", "admin-1");
    expect(firstPage.resources).toHaveLength(50);
    expect(firstPage.resourcePagination).toMatchObject({ previousCursor: null });
    expect(firstPage.resourcePagination.nextCursor).not.toBeNull();

    const secondPage = await loadWorkspaceSettingsPanel(database, "operations", "admin-1", {
      resourceCursor: firstPage.resourcePagination.nextCursor,
      resourceDirection: "after",
    });
    expect(secondPage.resources).toHaveLength(25);
    expect(secondPage.resources.at(-1)?.id).toBe("machine-075");
    expect(secondPage.resourcePagination.nextCursor).toBeNull();
    expect(secondPage.resourcePagination.previousCursor).not.toBeNull();
    expect(secondPage.resources.map((resource) => resource.id)).not.toContain(
      firstPage.resources.at(-1)?.id,
    );

    const previousPage = await loadWorkspaceSettingsPanel(database, "operations", "admin-1", {
      resourceCursor: secondPage.resourcePagination.previousCursor,
      resourceDirection: "before",
    });
    expect(previousPage.resources.map((resource) => resource.id)).toEqual(
      firstPage.resources.map((resource) => resource.id),
    );
  });

  it("ignores malformed public resource cursors", async () => {
    const panel = await loadWorkspaceSettingsPanel(database, "operations", "admin-1", {
      resourceCursor: JSON.stringify(["machine", "Edge"]),
      resourceDirection: "before",
    });

    expect(panel.resources.map((resource) => resource.id)).toEqual(["machine-1"]);
    expect(panel.resourcePagination).toEqual({ previousCursor: null, nextCursor: null });
  });
});

describe("workspace storage estimate bounds", () => {
  it("marks estimates as minimums after the modeled resource limit", async () => {
    await database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1001
         )
         INSERT INTO check_configs (id, workspace_id, enabled)
         SELECT printf('check-%04d', value), 'workspace-1', 1 FROM sequence`,
      )
      .run();

    const panel = await loadWorkspaceSettingsPanel(database, "operations", "admin-1");
    expect(panel.estimatedStorageCapped).toBe(true);
    expect(panel.estimatedStorageGb).toBe(
      estimateTelemetryStorageGb({
        machineCount: 1,
        checkCount: 1_000,
        retention: panel.retention,
      }),
    );
  });
});

describe("dashboard appearance", () => {
  async function migrateAppearance() {
    await database
      .prepare("ALTER TABLE dashboards ADD COLUMN appearance_json TEXT NOT NULL DEFAULT '{}' ")
      .run();
  }
  it("persists bounded site defaults with an audit entry", async () => {
    await migrateAppearance();
    expect(await loadSiteAppearance(database, "operations", "admin-1")).toEqual(
      defaultSiteAppearance,
    );
    const appearance = {
      ...defaultSiteAppearance,
      title: "My network",
      palette: "mint" as const,
      logoUrl: "https://cdn.example.test/logo.svg",
    };
    await updateSiteAppearance(database, "operations", "admin-1", appearance);
    expect(await loadSiteAppearance(database, "operations", "admin-1")).toEqual(appearance);
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'dashboard.appearance.update'",
        )
        .first(),
    ).toEqual({ count: 1 });
  });
  it("rejects an unsafe logo before writing settings or audit data", async () => {
    await migrateAppearance();
    await expect(
      updateSiteAppearance(database, "operations", "admin-1", {
        ...defaultSiteAppearance,
        logoUrl: "data:image/svg+xml,<svg/>",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await loadSiteAppearance(database, "operations", "admin-1")).toEqual(
      defaultSiteAppearance,
    );
    expect(await database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first()).toEqual({
      count: 0,
    });
  });
  it("denies member and cross-workspace writes", async () => {
    await migrateAppearance();
    await database
      .prepare("INSERT INTO memberships VALUES ('workspace-1','member-1','member','active')")
      .run();
    await expect(
      updateSiteAppearance(database, "operations", "member-1", {
        ...defaultSiteAppearance,
        logoUrl: "/other-logo.svg",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateSiteAppearance(database, "other-workspace", "admin-1", defaultSiteAppearance),
    ).rejects.toMatchObject({ status: 404 });
    expect(await loadSiteAppearance(database, "operations", "admin-1")).toEqual(
      defaultSiteAppearance,
    );
  });
  it("rechecks admin permission at the write and does not audit a rejected change", async () => {
    await migrateAppearance();
    await expect(
      updateSiteAppearance(mutateBeforeBatch(database), "operations", "admin-1", {
        ...defaultSiteAppearance,
        title: "No longer allowed",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await database
        .prepare("SELECT appearance_json FROM dashboards WHERE id = 'dashboard-1'")
        .first(),
    ).toEqual({ appearance_json: "{}" });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM audit_logs").first()).toEqual({
      count: 0,
    });
  });
});
