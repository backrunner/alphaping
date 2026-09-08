import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  ]);
  await telemetryDb.batch([
    telemetryDb.prepare(`CREATE TABLE state_events (
      workspace_pk INTEGER NOT NULL, resource_type INTEGER NOT NULL,
      resource_pk INTEGER NOT NULL, occurred_at INTEGER NOT NULL, event_id BLOB NOT NULL,
      previous_state TEXT NOT NULL, current_state TEXT NOT NULL, reason_code TEXT NOT NULL,
      PRIMARY KEY (resource_type, resource_pk, occurred_at, event_id)
    ) WITHOUT ROWID`),
  ]);
  const controlMigration = await readFile(
    new URL(
      "../../../packages/db/migrations/control/0025_notification_delivery_progress.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await controlDb.batch(
    controlMigration
      .split(";")
      .filter((sql) => sql.trim())
      .map((sql) => controlDb.prepare(sql)),
  );
  const queueMigration = await readFile(
    new URL(
      "../../../packages/db/migrations/telemetry/0012_notification_event_queue.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const [table, trigger] = queueMigration.split("CREATE TRIGGER");
  if (!table || !trigger) throw new Error("notification queue migration fixture is incomplete");
  await telemetryDb.batch([
    telemetryDb.prepare(table),
    telemetryDb.prepare(`CREATE TRIGGER${trigger}`),
  ]);
});

afterAll(async () => {
  await miniflare.dispose();
});

beforeEach(async () => {
  await controlDb.batch([
    ...[
      "notification_deliveries",
      "notification_rules",
      "notification_channels",
      "machines",
      "workspaces",
      "notification_event_cursors",
    ].map((table) => controlDb.prepare(`DELETE FROM ${table}`)),
    controlDb.prepare(`INSERT INTO workspaces VALUES ('workspace-1', 10, 'Operations', NULL)`),
    controlDb.prepare(
      `INSERT INTO machines VALUES ('machine-1', 20, 'workspace-1', 'edge-01', NULL)`,
    ),
    controlDb.prepare(`INSERT INTO notification_channels VALUES ('channel-1', 'workspace-1', 1)`),
    controlDb.prepare(`INSERT INTO notification_rules VALUES (
      'rule-1', 'workspace-1', 'machine', 'machine-1', 'availability', 'channel-1', 1
    )`),
    controlDb.prepare(
      `INSERT INTO notification_event_cursors (singleton, last_occurred_at, last_event_id, last_resource_type, last_resource_pk, updated_at) VALUES (1, 0, X'', 0, 0, 0)`,
    ),
  ]);
  await telemetryDb.batch([
    telemetryDb.prepare("DELETE FROM state_events"),
    telemetryDb.prepare(`INSERT INTO state_events VALUES (
      10, 1, 20, 100, X'01', 'unknown', 'healthy', 'resource_recovered'
    )`),
  ]);
});

describe("notification event discovery", () => {
  it("does not move the bootstrap boundary after another first run has initialized it", async () => {
    // Simulate a second invocation that read the uninitialized cursor before the first committed.
    const staleCursor = await controlDb
      .prepare("SELECT last_sequence, updated_at FROM notification_event_cursors")
      .first();
    await discoverNotificationEvents(controlDb, telemetryDb, 1_000);
    await telemetryDb
      .prepare(
        "INSERT INTO state_events VALUES (10, 1, 20, 200, X'55', 'healthy', 'offline', 'report_timeout')",
      )
      .run();
    let firstRead = true;
    const overlappingDb = {
      prepare(sql: string) {
        if (firstRead && sql.includes("SELECT last_sequence, updated_at")) {
          firstRead = false;
          return { first: async () => staleCursor } as D1PreparedStatement;
        }
        return controlDb.prepare(sql);
      },
      batch: (statements: D1PreparedStatement[]) => controlDb.batch(statements),
    } as D1Database;
    await expect(discoverNotificationEvents(overlappingDb, telemetryDb, 2_000)).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      bootstrapped: false,
    });
    expect(
      await controlDb
        .prepare("SELECT count(*) AS count FROM notification_deliveries")
        .first("count"),
    ).toBe(1);
  });

  it("retains queued events until the delivery outbox is durable", async () => {
    await discoverNotificationEvents(controlDb, telemetryDb, 1_000);
    await telemetryDb
      .prepare(
        "INSERT INTO state_events VALUES (10, 1, 20, 200, X'33', 'healthy', 'offline', 'report_timeout')",
      )
      .run();
    await controlDb
      .prepare(
        `CREATE TRIGGER reject_notification_delivery
      BEFORE INSERT ON notification_deliveries
      BEGIN SELECT RAISE(ABORT, 'synthetic outbox failure'); END`,
      )
      .run();
    await expect(discoverNotificationEvents(controlDb, telemetryDb, 2_000)).rejects.toThrow(
      "synthetic outbox failure",
    );
    expect(
      await telemetryDb
        .prepare("SELECT count(*) AS count FROM notification_event_queue")
        .first("count"),
    ).toBe(1);
    await controlDb.prepare("DROP TRIGGER reject_notification_delivery").run();
    await expect(discoverNotificationEvents(controlDb, telemetryDb, 3_000)).resolves.toMatchObject({
      scanned: 1,
      enqueued: 1,
    });
    expect(
      await telemetryDb
        .prepare("SELECT count(*) AS count FROM notification_event_queue")
        .first("count"),
    ).toBe(0);
    expect(
      await controlDb
        .prepare("SELECT count(*) AS count FROM notification_deliveries")
        .first("count"),
    ).toBe(1);
  });

  it("keeps duplicate inserts idempotent and removes queue entries with expired source events", async () => {
    const insert = telemetryDb.prepare(
      "INSERT OR IGNORE INTO state_events VALUES (10, 1, 20, 200, X'44', 'healthy', 'offline', 'report_timeout')",
    );
    await telemetryDb.batch([insert, insert]);
    expect(
      await telemetryDb
        .prepare("SELECT count(*) AS count FROM notification_event_queue WHERE occurred_at = 200")
        .first("count"),
    ).toBe(1);
    await telemetryDb.prepare("DELETE FROM state_events WHERE occurred_at = 200").run();
    expect(
      await telemetryDb
        .prepare("SELECT count(*) AS count FROM notification_event_queue WHERE occurred_at = 200")
        .first("count"),
    ).toBe(0);
  });
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

  it("discovers a full batch without exceeding D1's bound parameter limit", async () => {
    await discoverNotificationEvents(controlDb, telemetryDb, 1_000);
    for (let offset = 0; offset < 100; offset += 25) {
      await controlDb.batch(
        Array.from({ length: 25 }, (_, index) => offset + index).flatMap((index) => [
          controlDb
            .prepare("INSERT INTO machines VALUES (?, ?, 'workspace-1', ?, NULL)")
            .bind(`scale-${index}`, 1_000 + index, `Scale ${index}`),
          controlDb
            .prepare(
              "INSERT INTO notification_rules VALUES (?, 'workspace-1', 'machine', ?, 'availability', 'channel-1', 1)",
            )
            .bind(`rule-scale-${index}`, `scale-${index}`),
        ]),
      );
      await telemetryDb.batch(
        Array.from({ length: 25 }, (_, index) => offset + index).map((index) =>
          telemetryDb
            .prepare(
              "INSERT INTO state_events VALUES (10, 1, ?, ?, X'11', 'healthy', 'offline', 'report_timeout')",
            )
            .bind(1_000 + index, 500 + index),
        ),
      );
    }
    await expect(discoverNotificationEvents(controlDb, telemetryDb, 4_000)).resolves.toMatchObject({
      scanned: 100,
      enqueued: 100,
    });
  });

  it("discovers a late report whose event time precedes the last scanned event", async () => {
    await discoverNotificationEvents(controlDb, telemetryDb, 1_000);
    await telemetryDb
      .prepare(
        "INSERT INTO state_events VALUES (10, 1, 20, 300, X'23', 'healthy', 'offline', 'report_timeout')",
      )
      .run();
    await discoverNotificationEvents(controlDb, telemetryDb, 2_000);
    await telemetryDb
      .prepare(
        "INSERT INTO state_events VALUES (10, 1, 20, 250, X'22', 'healthy', 'offline', 'report_timeout')",
      )
      .run();
    await expect(discoverNotificationEvents(controlDb, telemetryDb, 5_000)).resolves.toMatchObject({
      scanned: 1,
      enqueued: 1,
    });
  });
});
