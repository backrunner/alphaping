import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discoverNotificationEvents } from "./discovery.js";

let miniflare: Miniflare;
let controlDb: D1Database;
let telemetryDb: D1Database;

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-15",
    d1Databases: { CONTROL_DB: "notification-control", TELEMETRY_DB: "notification-telemetry" },
  });
  controlDb = await miniflare.getD1Database("CONTROL_DB");
  telemetryDb = await miniflare.getD1Database("TELEMETRY_DB");
  await controlDb.batch([
    controlDb.prepare(`CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, name TEXT NOT NULL, deleted_at INTEGER
    )`),
    controlDb.prepare(`CREATE TABLE machines (
      id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, workspace_id TEXT NOT NULL,
      name TEXT NOT NULL, deleted_at INTEGER
    )`),
    controlDb.prepare(`CREATE TABLE notification_channels (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, enabled INTEGER NOT NULL
    )`),
    controlDb.prepare(`CREATE TABLE notification_rules (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL, dimension TEXT NOT NULL, channel_id TEXT NOT NULL,
      enabled INTEGER NOT NULL
    )`),
    controlDb.prepare(`CREATE TABLE notification_event_cursors (
      singleton INTEGER PRIMARY KEY, last_occurred_at INTEGER NOT NULL,
      last_event_id BLOB NOT NULL, last_resource_type INTEGER NOT NULL,
      last_resource_pk INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    controlDb.prepare(`CREATE TABLE notification_deliveries (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      source_workspace_pk INTEGER NOT NULL, source_resource_type INTEGER NOT NULL,
      source_resource_pk INTEGER NOT NULL, source_occurred_at INTEGER NOT NULL,
      source_event_id TEXT NOT NULL, dimension TEXT NOT NULL, payload_json TEXT NOT NULL,
      state TEXT NOT NULL, attempt_count INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (channel_id, source_workspace_pk, source_resource_type, source_resource_pk,
              source_occurred_at, source_event_id)
    )`),
    controlDb.prepare(`INSERT INTO workspaces VALUES ('workspace-1', 10, 'Operations', NULL)`),
    controlDb.prepare(
      `INSERT INTO machines VALUES ('machine-1', 20, 'workspace-1', 'edge-01', NULL)`,
    ),
    controlDb.prepare(`INSERT INTO notification_channels VALUES ('channel-1', 'workspace-1', 1)`),
    controlDb.prepare(`INSERT INTO notification_rules VALUES (
      'rule-1', 'workspace-1', 'machine', 'machine-1', 'availability', 'channel-1', 1
    )`),
    controlDb.prepare(`INSERT INTO notification_event_cursors VALUES (1, 0, X'', 0, 0, 0)`),
  ]);
  await telemetryDb.batch([
    telemetryDb.prepare(`CREATE TABLE state_events (
      workspace_pk INTEGER NOT NULL, resource_type INTEGER NOT NULL,
      resource_pk INTEGER NOT NULL, occurred_at INTEGER NOT NULL, event_id BLOB NOT NULL,
      previous_state TEXT NOT NULL, current_state TEXT NOT NULL, reason_code TEXT NOT NULL,
      PRIMARY KEY (resource_type, resource_pk, occurred_at, event_id)
    ) WITHOUT ROWID`),
    telemetryDb.prepare(`INSERT INTO state_events VALUES (
      10, 1, 20, 100, X'01', 'unknown', 'healthy', 'resource_recovered'
    )`),
  ]);
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("notification event discovery", () => {
  it("bootstraps without replaying history, then enqueues and deduplicates new transitions", async () => {
    await expect(discoverNotificationEvents(controlDb, telemetryDb, 1_000)).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      bootstrapped: true,
    });
    await telemetryDb
      .prepare(
        `INSERT INTO state_events VALUES (
        10, 1, 20, 200, X'02', 'healthy', 'offline', 'report_timeout'
      )`,
      )
      .run();
    await expect(discoverNotificationEvents(controlDb, telemetryDb, 2_000)).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      bootstrapped: false,
    });
    const delivery = await controlDb
      .prepare(`SELECT dimension, state, payload_json FROM notification_deliveries`)
      .first<{ dimension: string; state: string; payload_json: string }>();
    expect(delivery).toMatchObject({ dimension: "availability", state: "pending" });
    expect(JSON.parse(delivery?.payload_json ?? "{}")).toMatchObject({
      workspace: "Operations",
      resourceName: "edge-01",
      currentState: "offline",
    });
    await expect(discoverNotificationEvents(controlDb, telemetryDb, 3_000)).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      bootstrapped: false,
    });
  });
});
