import { readFile } from "node:fs/promises";

import { wrapNotificationConfig } from "@alphaping/contracts";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverNotificationOutbox } from "./outbox.js";
import { sendNotification } from "./providers.js";

vi.mock("./providers.js", () => ({ sendNotification: vi.fn() }));

const wrappingKey = "31".repeat(32);
let miniflare: Miniflare;
let db: D1Database;
let now: number;

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-15",
    d1Databases: { CONTROL_DB: "notification-outbox" },
  });
  db = await miniflare.getD1Database("CONTROL_DB");
  await db.batch([
    db.prepare("CREATE TABLE user (id TEXT PRIMARY KEY)"),
    db.prepare(`CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, deleted_at INTEGER
    )`),
    ...["machines", "services"].map((table) =>
      db.prepare(`CREATE TABLE ${table} (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, telemetry_pk INTEGER NOT NULL,
        deleted_at INTEGER
      )`),
    ),
  ]);
  const migration = await readFile(
    new URL("../../../packages/db/migrations/control/0023_notifications.sql", import.meta.url),
    "utf8",
  );
  await db.batch(
    migration
      .split(";")
      .filter((sql) => sql.trim())
      .map((sql) => db.prepare(sql)),
  );
});

afterAll(async () => {
  await miniflare.dispose();
});
afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.mocked(sendNotification).mockReset().mockResolvedValue({
    ok: true,
    retryable: false,
    status: 200,
    error: null,
  });
  await db.batch([
    ...[
      "notification_deliveries",
      "notification_rules",
      "notification_channels",
      "machines",
      "services",
      "workspaces",
      "user",
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
    db.prepare("INSERT INTO user VALUES ('admin')"),
    db.prepare("INSERT INTO workspaces VALUES ('workspace', 1, NULL)"),
    db.prepare("INSERT INTO machines VALUES ('machine', 'workspace', 10, NULL)"),
    db.prepare("INSERT INTO services VALUES ('service', 'workspace', 20, NULL)"),
  ]);
  const encrypted = await wrapNotificationConfig(
    { webhookUrl: "https://hooks.slack.com/services/T/B/fixture" },
    wrappingKey,
    "workspace",
    "channel",
  );
  await db
    .prepare(
      `INSERT INTO notification_channels
    (id, workspace_id, name, provider, config_ciphertext, config_nonce, created_by, created_at, updated_at)
    VALUES ('channel', 'workspace', 'Alerts', 'slack', ?, ?, 'admin', ?, ?)`,
    )
    .bind(encrypted.ciphertext, encrypted.nonce, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO notification_rules
    (id, workspace_id, resource_type, resource_id, dimension, channel_id, created_by, created_at, updated_at)
    VALUES ('rule', 'workspace', 'machine', 'machine', 'availability', 'channel', 'admin', ?, ?)`,
    )
    .bind(now, now)
    .run();
});

async function enqueue(id = "delivery", resourceType = 1): Promise<void> {
  const payload = {
    workspace: "Operations",
    resourceType: resourceType === 1 ? "machine" : "service",
    resourceName: id,
    dimension: "availability",
    previousState: "healthy",
    currentState: "offline",
    reasonCode: "report_timeout",
    occurredAt: now,
  };
  await db
    .prepare(
      `INSERT INTO notification_deliveries
    (id, workspace_id, channel_id, source_workspace_pk, source_resource_type, source_resource_pk,
     source_occurred_at, source_event_id, dimension, payload_json, created_at, updated_at)
    VALUES (?, 'workspace', 'channel', 1, ?, ?, ?, ?, 'availability', ?, ?, ?)`,
    )
    .bind(
      id,
      resourceType,
      resourceType === 1 ? 10 : 20,
      now,
      id,
      JSON.stringify(payload),
      now,
      now,
    )
    .run();
}

describe("notification outbox claims", () => {
  it("does not let overlapping invocations send a claimed delivery twice", async () => {
    await enqueue();
    await Promise.all([
      deliverNotificationOutbox(db, wrappingKey),
      deliverNotificationOutbox(db, wrappingKey),
    ]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(await db.prepare("SELECT state FROM notification_deliveries").first("state")).toBe(
      "sent",
    );
  });

  it("starts later batch leases when the delivery is claimed", async () => {
    for (let index = 1; index <= 6; index += 1) await enqueue(`delivery-${index}`);
    let lastLease = 0;
    let claimedAt = 0;
    vi.mocked(sendNotification).mockImplementation(async (_provider, _config, payload) => {
      if (payload.resourceName === "delivery-6") {
        claimedAt = now;
        lastLease =
          (await db
            .prepare("SELECT claim_until FROM notification_deliveries WHERE id = 'delivery-6'")
            .first<number>("claim_until")) ?? 0;
      } else {
        now += 10_000;
      }
      return { ok: true, retryable: false, status: 200, error: null };
    });
    await deliverNotificationOutbox(db, wrappingKey);
    expect(lastLease).toBeGreaterThan(claimedAt);
    expect(sendNotification).toHaveBeenCalledTimes(6);
  });

  it.each([
    "DELETE FROM notification_rules",
    "UPDATE notification_rules SET enabled = 0",
    "UPDATE notification_channels SET enabled = 0",
    "UPDATE machines SET deleted_at = 1",
    "UPDATE workspaces SET deleted_at = 1",
    "UPDATE notification_rules SET workspace_id = 'other'",
  ])("does not send queued notifications after policy revocation: %s", async (mutation) => {
    await enqueue();
    await db.prepare("INSERT INTO workspaces VALUES ('other', 2, NULL)").run();
    await db.prepare(mutation).run();
    await deliverNotificationOutbox(db, wrappingKey);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT state FROM notification_deliveries").first("state")).toBe(
      "dead",
    );
  });

  it("checks the matching service rule before sending service notifications", async () => {
    await db
      .prepare("UPDATE notification_rules SET resource_type = 'service', resource_id = 'service'")
      .run();
    await enqueue("service-event", 2);
    await deliverNotificationOutbox(db, wrappingKey);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    await enqueue("deleted-service-event", 2);
    await db.prepare("UPDATE services SET deleted_at = 1").run();
    await deliverNotificationOutbox(db, wrappingKey);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("stops reclaiming a delivery after its final attempt loses its lease", async () => {
    await enqueue();
    await db
      .prepare(
        `UPDATE notification_deliveries SET state = 'delivering',
      attempt_count = 6, claim_until = ?, claim_token = 'expired'`,
      )
      .bind(now - 1)
      .run();
    await deliverNotificationOutbox(db, wrappingKey);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(
      await db.prepare("SELECT state, attempt_count FROM notification_deliveries").first(),
    ).toEqual({ state: "dead", attempt_count: 6 });
  });
});
