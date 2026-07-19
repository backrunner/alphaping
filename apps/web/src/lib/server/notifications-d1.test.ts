import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createNotificationChannel,
  createNotificationRule,
  deleteNotificationChannel,
  loadNotificationPanel,
  updateNotificationChannel,
} from "./notifications.js";

const KEY = "24".repeat(32);
let miniflare: Miniflare;
let database: D1Database;

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-15",
    d1Databases: { CONTROL_DB: "notification-management" },
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(`CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
      default_dashboard_id TEXT, default_sampling_interval_seconds INTEGER NOT NULL,
      deleted_at INTEGER
    )`),
    database.prepare(`CREATE TABLE memberships (
      workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
      status TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id)
    )`),
    database.prepare(`CREATE TABLE machines (
      id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, workspace_id TEXT NOT NULL,
      name TEXT NOT NULL, deleted_at INTEGER
    )`),
    database.prepare(`CREATE TABLE services (
      id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, workspace_id TEXT NOT NULL,
      name TEXT NOT NULL, deleted_at INTEGER
    )`),
    database.prepare(`CREATE TABLE notification_channels (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL,
      config_ciphertext BLOB NOT NULL, config_nonce BLOB NOT NULL, wrapping_key_id TEXT NOT NULL,
      config_summary_json TEXT NOT NULL, enabled INTEGER NOT NULL, created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE notification_rules (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL, dimension TEXT NOT NULL,
      channel_id TEXT NOT NULL REFERENCES notification_channels (id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL, created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (channel_id, resource_type, resource_id, dimension)
    )`),
    database.prepare(`CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_user_id TEXT,
      action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      before_digest TEXT, after_digest TEXT, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    database.prepare(`INSERT INTO workspaces VALUES (
      'workspace-1', 10, 'operations', 'Operations', 'dashboard-1', 10, NULL
    )`),
    database.prepare(`INSERT INTO memberships VALUES ('workspace-1', 'admin-1', 'admin', 'active')`),
    database.prepare(`INSERT INTO machines VALUES ('machine-1', 20, 'workspace-1', 'edge-01', NULL)`),
  ]);
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("notification management persistence", () => {
  it("creates, reads, updates, routes, and deletes write-only channels", async () => {
    const channelId = await createNotificationChannel(
      database,
      "operations",
      "admin-1",
      KEY,
      {
        name: "Operations Slack",
        provider: "slack",
        config: { webhookUrl: "https://hooks.slack.com/services/T/B/secret" },
      },
    );
    let panel = await loadNotificationPanel(database, "operations", "admin-1");
    expect(panel.channels).toEqual([
      expect.objectContaining({
        id: channelId,
        name: "Operations Slack",
        provider: "slack",
        summary: { webhookHost: "hooks.slack.com" },
        enabled: true,
      }),
    ]);
    expect(JSON.stringify(panel)).not.toContain("secret");

    await createNotificationRule(database, "operations", "admin-1", {
      resourceType: "machine",
      resourceId: "machine-1",
      dimension: "availability",
      channelId,
    });
    panel = await loadNotificationPanel(database, "operations", "admin-1");
    expect(panel.rules).toEqual([
      expect.objectContaining({
        resourceName: "edge-01",
        dimension: "availability",
        channelName: "Operations Slack",
      }),
    ]);

    await updateNotificationChannel(database, "operations", "admin-1", {
      channelId,
      name: "Primary Slack",
      enabled: false,
    });
    panel = await loadNotificationPanel(database, "operations", "admin-1");
    expect(panel.channels[0]).toMatchObject({ name: "Primary Slack", enabled: false });

    await deleteNotificationChannel(database, "operations", "admin-1", channelId);
    panel = await loadNotificationPanel(database, "operations", "admin-1");
    expect(panel.channels).toEqual([]);
    expect(panel.rules).toEqual([]);
  });
});
