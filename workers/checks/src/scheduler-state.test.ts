import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDueChecks, processCheckBatches } from "./index.js";
import { loadMachineLivenessCandidates } from "./machine-liveness.js";
import { acquireSchedulerLease, releaseSchedulerLease } from "./scheduler-state.js";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

const SCHEDULED_AT = 120_000;

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "checks-scheduler-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        maintenance_until INTEGER,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        executor_kind TEXT NOT NULL,
        config_revision INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL,
        interval_seconds INTEGER NOT NULL,
        phase_seconds INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        retry_count INTEGER NOT NULL,
        critical INTEGER NOT NULL,
        request_json TEXT NOT NULL,
        secret_refs_json TEXT NOT NULL,
        failure_confirmations INTEGER NOT NULL,
        recovery_confirmations INTEGER NOT NULL,
        last_claimed_slot INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY,
        telemetry_pk INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        offline_after_seconds INTEGER NOT NULL,
        maintenance_until INTEGER,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE check_scheduler_state (
        singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
        check_cursor INTEGER NOT NULL DEFAULT 0,
        machine_cursor INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID, STRICT`,
    ),
    database.prepare(
      `INSERT INTO workspaces (id, telemetry_pk, deleted_at)
       VALUES ('workspace-1', 1, NULL)`,
    ),
    database.prepare(
      `INSERT INTO services (id, telemetry_pk, maintenance_until, deleted_at)
       VALUES ('service-1', 1, NULL, NULL)`,
    ),
    database.prepare(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 500
       )
       INSERT INTO check_configs
         (id, telemetry_pk, workspace_id, service_id, kind, executor_kind, enabled,
          interval_seconds, phase_seconds, timeout_ms, retry_count, critical,
          request_json, secret_refs_json, failure_confirmations, recovery_confirmations,
          last_claimed_slot)
       SELECT printf('daily-%04d', value), value, 'workspace-1', 'service-1',
              'http', 'cloudflare', 1, 86400, 0, 1000, 0, 1,
              '{}', '{}', 1, 1, 0
       FROM sequence`,
    ),
    database.prepare(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 501
       )
       INSERT INTO check_configs
         (id, telemetry_pk, workspace_id, service_id, kind, executor_kind, enabled,
          interval_seconds, phase_seconds, timeout_ms, retry_count, critical,
          request_json, secret_refs_json, failure_confirmations, recovery_confirmations,
          last_claimed_slot)
       SELECT printf('minute-%04d', value), value + 500, 'workspace-1', 'service-1',
              'http', 'cloudflare', 1, 60, 0, 1000, 0, 1,
              '{}', '{}', 1, 1, 0
       FROM sequence`,
    ),
    database.prepare(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 1001
       )
       INSERT INTO machines
         (id, telemetry_pk, workspace_id, offline_after_seconds, maintenance_until, deleted_at)
       SELECT printf('machine-%04d', value), value, 'workspace-1', 150, NULL, NULL
       FROM sequence`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("bounded scheduler scans", () => {
  it("filters due checks before applying the 500-row bound", async () => {
    const first = await loadDueChecks(database, SCHEDULED_AT, 0);

    expect(first).toHaveLength(500);
    expect(first[0]?.telemetry_pk).toBe(501);
    expect(first[0]?.config_revision).toBe(1);
    expect(first[499]?.telemetry_pk).toBe(1000);

    await database
      .prepare(
        `UPDATE check_configs SET last_claimed_slot = 120
         WHERE telemetry_pk BETWEEN 501 AND 1000`,
      )
      .run();
    const second = await loadDueChecks(database, SCHEDULED_AT, 1000);

    expect(second.map((check) => check.telemetry_pk)).toEqual([1001]);
  });

  it("rotates the machine scan after the persisted telemetry cursor", async () => {
    const first = await loadMachineLivenessCandidates(database, 0);
    const second = await loadMachineLivenessCandidates(database, 1000);

    expect(first).toHaveLength(1000);
    expect(first[0]?.telemetry_pk).toBe(1);
    expect(first[999]?.telemetry_pk).toBe(1000);
    expect(second).toHaveLength(1000);
    expect(second[0]?.telemetry_pk).toBe(1001);
    expect(second[1]?.telemetry_pk).toBe(1);
    expect(second[999]?.telemetry_pk).toBe(999);
  });

  it("serializes scheduler runs and protects a replacement lease from stale release", async () => {
    const first = await acquireSchedulerLease(database, 1_000);
    expect(first).not.toBeNull();
    if (first === null) throw new Error("scheduler lease was not acquired");

    await expect(acquireSchedulerLease(database, 1_001)).resolves.toBeNull();
    await expect(releaseSchedulerLease(database, first, 1001, 999, 1_002)).resolves.toBe(true);

    const resumed = await acquireSchedulerLease(database, 1_003);
    expect(resumed).toMatchObject({ checkCursor: 1001, machineCursor: 999 });
    if (resumed === null) throw new Error("released scheduler lease was not reacquired");

    const replacement = await acquireSchedulerLease(database, resumed.leaseUntil);
    expect(replacement).not.toBeNull();
    await expect(releaseSchedulerLease(database, resumed, 1, 1, resumed.leaseUntil)).resolves.toBe(
      false,
    );
  });
});

describe("bounded check execution", () => {
  it("runs five checks concurrently and preserves the first deferred cursor", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({ telemetry_pk: index + 1 }));
    let active = 0;
    let maximumActive = 0;
    const progress = await processCheckBatches(
      candidates,
      (batch) => batch[0]?.telemetry_pk === 1,
      async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      },
    );

    expect(progress).toEqual({
      processed: 5,
      failed: 0,
      lastCursor: 5,
      deadlineReached: true,
    });
    expect(maximumActive).toBe(5);
  });

  it("records failed checks while advancing past the attempted batch", async () => {
    const progress = await processCheckBatches(
      [{ telemetry_pk: 1 }, { telemetry_pk: 2 }],
      () => true,
      (candidate) =>
        candidate.telemetry_pk === 2
          ? Promise.reject(new Error("persistence failed"))
          : Promise.resolve(),
    );

    expect(progress).toEqual({
      processed: 2,
      failed: 1,
      lastCursor: 2,
      deadlineReached: false,
    });
  });
});
