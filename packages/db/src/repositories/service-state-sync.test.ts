import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createServiceStateSyncJob,
  prepareServiceStateSyncJob,
  reconcileServiceStateSyncJobs,
} from "./service-state-sync";

let miniflare: Miniflare;
let controlDb: D1Database;
let telemetryDb: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "control-test", TELEMETRY_DB: "telemetry-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  controlDb = await miniflare.getD1Database("CONTROL_DB");
  telemetryDb = await miniflare.getD1Database("TELEMETRY_DB");
  await controlDb.batch([
    controlDb.prepare(
      "CREATE TABLE workspaces (id TEXT PRIMARY KEY, telemetry_pk INTEGER, deleted_at INTEGER)",
    ),
    controlDb.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY, workspace_id TEXT, telemetry_pk INTEGER,
        maintenance_until INTEGER, deleted_at INTEGER
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY, workspace_id TEXT, service_id TEXT, telemetry_pk INTEGER,
        enabled INTEGER, critical INTEGER, executor_kind TEXT, config_revision INTEGER
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE service_state_sync_jobs (
        job_key TEXT PRIMARY KEY, sync_token TEXT, workspace_id TEXT, workspace_pk INTEGER,
        service_id TEXT, service_pk INTEGER, check_id TEXT, check_pk INTEGER,
        reason_code TEXT, protect_until INTEGER, next_attempt_at INTEGER,
        last_attempted_at INTEGER, updated_at INTEGER
      )`,
    ),
    controlDb.prepare("INSERT INTO workspaces VALUES ('workspace-1', 1, NULL)"),
    controlDb.prepare("INSERT INTO services VALUES ('service-1', 'workspace-1', 10, NULL, NULL)"),
    controlDb.prepare(
      `INSERT INTO check_configs VALUES
        ('check-a', 'workspace-1', 'service-1', 101, 0, 1, 'cloudflare', 1),
        ('check-b', 'workspace-1', 'service-1', 102, 1, 1, 'cloudflare', 1)`,
    ),
  ]);
  await telemetryDb.batch([
    telemetryDb.prepare(
      `CREATE TABLE check_latest (
        check_pk INTEGER PRIMARY KEY, service_pk INTEGER, state TEXT, critical INTEGER,
        config_revision INTEGER NOT NULL DEFAULT 0
      )`,
    ),
    telemetryDb.prepare(
      `CREATE TABLE service_latest (
        service_pk INTEGER PRIMARY KEY, workspace_pk INTEGER, state TEXT, status_since INTEGER,
        reason_code TEXT, last_transition_at INTEGER, updated_at INTEGER
      )`,
    ),
    telemetryDb.prepare(
      `CREATE TABLE state_events (
        workspace_pk INTEGER, resource_type INTEGER, resource_pk INTEGER, occurred_at INTEGER,
        event_id BLOB, previous_state TEXT, current_state TEXT, reason_code TEXT,
        PRIMARY KEY (resource_type, resource_pk, occurred_at, event_id)
      )`,
    ),
    telemetryDb.prepare("INSERT INTO check_latest VALUES (101, 10, 'down', 1, 1)"),
    telemetryDb.prepare("INSERT INTO check_latest VALUES (102, 10, 'healthy', 1, 1)"),
    telemetryDb.prepare("INSERT INTO service_latest VALUES (10, 1, 'down', 1, 'check_down', 1, 1)"),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("service state synchronization", () => {
  it("reapplies a disabled-check correction through the in-flight guard window", async () => {
    const job = createServiceStateSyncJob({
      workspaceId: "workspace-1",
      workspacePk: 1,
      serviceId: "service-1",
      servicePk: 10,
      checkId: "check-a",
      checkPk: 101,
      reasonCode: "check_configuration",
      updatedAt: 1_000,
    });
    await prepareServiceStateSyncJob(controlDb, job).run();

    await expect(
      reconcileServiceStateSyncJobs(controlDb, telemetryDb, job.protectUntil - 1),
    ).resolves.toEqual({ processed: 1, completed: 0, failed: 0 });
    await expect(
      telemetryDb.prepare("SELECT check_pk FROM check_latest ORDER BY check_pk").all(),
    ).resolves.toMatchObject({ results: [{ check_pk: 102 }] });
    await expect(
      telemetryDb.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "healthy" });

    await telemetryDb.batch([
      telemetryDb.prepare("INSERT INTO check_latest VALUES (101, 10, 'down', 1, 1)"),
      telemetryDb.prepare("UPDATE service_latest SET state = 'down' WHERE service_pk = 10"),
    ]);
    await expect(
      reconcileServiceStateSyncJobs(controlDb, telemetryDb, job.protectUntil),
    ).resolves.toEqual({ processed: 1, completed: 1, failed: 0 });
    await expect(
      telemetryDb.prepare("SELECT check_pk FROM check_latest ORDER BY check_pk").all(),
    ).resolves.toMatchObject({ results: [{ check_pk: 102 }] });
    await expect(
      controlDb.prepare("SELECT COUNT(*) AS count FROM service_state_sync_jobs").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("removes an older central revision without deleting the current result", async () => {
    await controlDb
      .prepare("UPDATE check_configs SET enabled = 1, config_revision = 2 WHERE id = 'check-a'")
      .run();
    const job = createServiceStateSyncJob({
      workspaceId: "workspace-1",
      workspacePk: 1,
      serviceId: "service-1",
      servicePk: 10,
      checkId: "check-a",
      checkPk: 101,
      reasonCode: "check_configuration",
      updatedAt: 1_000,
    });
    await prepareServiceStateSyncJob(controlDb, job).run();

    await expect(
      reconcileServiceStateSyncJobs(controlDb, telemetryDb, job.protectUntil - 1),
    ).resolves.toEqual({ processed: 1, completed: 0, failed: 0 });
    await expect(
      telemetryDb.prepare("SELECT check_pk FROM check_latest ORDER BY check_pk").all(),
    ).resolves.toMatchObject({ results: [{ check_pk: 102 }] });

    await telemetryDb.prepare("INSERT INTO check_latest VALUES (101, 10, 'down', 1, 2)").run();
    await expect(
      reconcileServiceStateSyncJobs(controlDb, telemetryDb, job.protectUntil),
    ).resolves.toEqual({ processed: 1, completed: 1, failed: 0 });
    await expect(
      telemetryDb
        .prepare("SELECT check_pk, config_revision FROM check_latest ORDER BY check_pk")
        .all(),
    ).resolves.toMatchObject({
      results: [
        { check_pk: 101, config_revision: 2 },
        { check_pk: 102, config_revision: 1 },
      ],
    });
    await expect(
      telemetryDb.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "down" });
  });

  it("keeps a job when telemetry synchronization fails", async () => {
    const job = createServiceStateSyncJob({
      workspaceId: "workspace-1",
      workspacePk: 1,
      serviceId: "service-1",
      servicePk: 10,
      checkId: "check-a",
      checkPk: 101,
      reasonCode: "check_configuration",
      updatedAt: 2_000,
    });
    await prepareServiceStateSyncJob(controlDb, job).run();
    const failingTelemetryDb = new Proxy(telemetryDb, {
      get(target, property) {
        if (property === "prepare") {
          return () => {
            throw new Error("telemetry unavailable");
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      reconcileServiceStateSyncJobs(controlDb, failingTelemetryDb, job.protectUntil),
    ).resolves.toEqual({ processed: 1, completed: 0, failed: 1 });
    await expect(
      controlDb
        .prepare(
          `SELECT COUNT(*) AS count, MAX(last_attempted_at) AS last_attempted_at,
                  MAX(next_attempt_at) AS next_attempt_at
           FROM service_state_sync_jobs`,
        )
        .first(),
    ).resolves.toEqual({
      count: 1,
      last_attempted_at: job.protectUntil,
      next_attempt_at: job.protectUntil,
    });
  });

  it("does not restore an expired maintenance window during delayed replay", async () => {
    await controlDb
      .prepare("UPDATE services SET maintenance_until = 2_000 WHERE id = 'service-1'")
      .run();
    await telemetryDb.prepare("DELETE FROM check_latest WHERE check_pk = 101").run();
    const job = createServiceStateSyncJob({
      workspaceId: "workspace-1",
      workspacePk: 1,
      serviceId: "service-1",
      servicePk: 10,
      checkId: null,
      checkPk: null,
      reasonCode: "maintenance_window",
      updatedAt: 1_000,
    });
    await prepareServiceStateSyncJob(controlDb, job).run();

    await expect(reconcileServiceStateSyncJobs(controlDb, telemetryDb, 3_000)).resolves.toEqual({
      processed: 1,
      completed: 0,
      failed: 0,
    });
    await expect(
      telemetryDb.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "healthy" });
  });

  it("sleeps a settled maintenance job until the window expires", async () => {
    const maintenanceUntil = 4_000_000;
    await controlDb
      .prepare("UPDATE services SET maintenance_until = ? WHERE id = 'service-1'")
      .bind(maintenanceUntil)
      .run();
    await telemetryDb.prepare("DELETE FROM check_latest WHERE check_pk = 101").run();
    const job = createServiceStateSyncJob({
      workspaceId: "workspace-1",
      workspacePk: 1,
      serviceId: "service-1",
      servicePk: 10,
      checkId: null,
      checkPk: null,
      reasonCode: "maintenance_window",
      updatedAt: 1_000,
    });
    await prepareServiceStateSyncJob(controlDb, job).run();

    const guardUntil = job.updatedAt + 15 * 60_000;
    await expect(
      reconcileServiceStateSyncJobs(controlDb, telemetryDb, guardUntil),
    ).resolves.toEqual({ processed: 1, completed: 0, failed: 0 });
    await expect(
      controlDb
        .prepare(
          `SELECT protect_until, next_attempt_at
           FROM service_state_sync_jobs WHERE job_key = ?`,
        )
        .bind(job.jobKey)
        .first(),
    ).resolves.toEqual({ protect_until: maintenanceUntil, next_attempt_at: maintenanceUntil });
    await expect(
      telemetryDb.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "maintenance" });

    await expect(
      reconcileServiceStateSyncJobs(controlDb, telemetryDb, guardUntil + 1),
    ).resolves.toEqual({ processed: 0, completed: 0, failed: 0 });
    await expect(
      reconcileServiceStateSyncJobs(controlDb, telemetryDb, maintenanceUntil),
    ).resolves.toEqual({ processed: 1, completed: 1, failed: 0 });
    await expect(
      telemetryDb
        .prepare("SELECT state, reason_code FROM service_latest WHERE service_pk = 10")
        .first(),
    ).resolves.toEqual({ state: "healthy", reason_code: "maintenance_window_ended" });
  });

  it("rotates attempted jobs so a protected backlog cannot starve newer work", async () => {
    const jobs = Array.from({ length: 3 }, (_, index) =>
      createServiceStateSyncJob({
        workspaceId: "workspace-1",
        workspacePk: 1,
        serviceId: "service-1",
        servicePk: 10,
        checkId: `missing-check-${String(index).padStart(2, "0")}`,
        checkPk: 1_000 + index,
        reasonCode: "check_configuration",
        updatedAt: 1_000,
      }),
    );
    await controlDb.batch(jobs.map((job) => prepareServiceStateSyncJob(controlDb, job)));

    await expect(reconcileServiceStateSyncJobs(controlDb, telemetryDb, 2_000, 2)).resolves.toEqual({
      processed: 2,
      completed: 0,
      failed: 0,
    });
    await expect(
      controlDb
        .prepare(
          "SELECT last_attempted_at FROM service_state_sync_jobs WHERE job_key = 'check:missing-check-02'",
        )
        .first(),
    ).resolves.toEqual({ last_attempted_at: 1_000 });

    await expect(reconcileServiceStateSyncJobs(controlDb, telemetryDb, 3_000, 2)).resolves.toEqual({
      processed: 2,
      completed: 0,
      failed: 0,
    });
    await expect(
      controlDb
        .prepare(
          "SELECT last_attempted_at FROM service_state_sync_jobs WHERE job_key = 'check:missing-check-02'",
        )
        .first(),
    ).resolves.toEqual({ last_attempted_at: 3_000 });
  });
});
