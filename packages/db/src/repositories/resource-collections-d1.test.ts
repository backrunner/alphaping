import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDashboardSnapshot } from "./dashboard.js";
import { loadMachineCollection } from "./machines.js";
import { loadServiceCollection, loadServiceDetail } from "./services.js";

let miniflare: Miniflare;
let controlDb: D1Database;
let telemetryDb: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "resource-control-test", TELEMETRY_DB: "resource-data-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  controlDb = await miniflare.getD1Database("CONTROL_DB");
  telemetryDb = await miniflare.getD1Database("TELEMETRY_DB");
  await controlDb.batch([
    controlDb.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
        telemetry_pk INTEGER NOT NULL, deleted_at INTEGER
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE resource_grants (
        workspace_id TEXT NOT NULL, subject_user_id TEXT NOT NULL, resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL, capability TEXT NOT NULL, effect TEXT NOT NULL
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE machines (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, workspace_id TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT NOT NULL, expected_host TEXT, labels_json TEXT NOT NULL,
        sampling_interval_seconds INTEGER NOT NULL, report_interval_seconds INTEGER NOT NULL,
        offline_after_seconds INTEGER NOT NULL, container_monitoring_enabled INTEGER NOT NULL,
        maintenance_until INTEGER, desired_config_revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL, deleted_at INTEGER
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE agents (
        id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, status TEXT NOT NULL,
        agent_version TEXT NOT NULL, platform TEXT NOT NULL, arch TEXT NOT NULL,
        applied_config_revision INTEGER NOT NULL, hostname TEXT NOT NULL,
        os_name TEXT NOT NULL, os_version TEXT NOT NULL, kernel_version TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_seen_at INTEGER
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, workspace_id TEXT NOT NULL,
        name TEXT NOT NULL, slug TEXT, description TEXT NOT NULL, maintenance_until INTEGER,
        created_at INTEGER NOT NULL, deleted_at INTEGER
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY, telemetry_pk INTEGER NOT NULL, workspace_id TEXT NOT NULL,
        service_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        executor_kind TEXT NOT NULL, executor_agent_id TEXT, enabled INTEGER NOT NULL,
        interval_seconds INTEGER NOT NULL, timeout_ms INTEGER NOT NULL, retry_count INTEGER NOT NULL,
        critical INTEGER NOT NULL, request_json TEXT NOT NULL, secret_refs_json TEXT NOT NULL,
        failure_confirmations INTEGER NOT NULL, recovery_confirmations INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE check_assertions (
        id TEXT PRIMARY KEY, check_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
        source TEXT NOT NULL, operator TEXT NOT NULL, selector TEXT,
        expected_json TEXT NOT NULL, severity TEXT NOT NULL
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE incidents (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, state TEXT NOT NULL,
        starts_at INTEGER NOT NULL, deleted_at INTEGER
      )`,
    ),
    controlDb.prepare(
      `CREATE TABLE incident_resources (
        incident_id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL
      )`,
    ),
    controlDb.prepare(`CREATE TABLE state_events_placeholder (id TEXT PRIMARY KEY)`),
    controlDb.prepare(
      `CREATE TABLE resource_public_policies (
        workspace_id TEXT NOT NULL, resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL, effect TEXT NOT NULL
      )`,
    ),
    controlDb.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 'Operations', 'operations', 1, NULL)`,
    ),
    controlDb.prepare(
      `INSERT INTO memberships VALUES
        ('workspace-1', 'admin-1', 'admin', 'active'),
        ('workspace-1', 'member-1', 'member', 'active')`,
    ),
    controlDb.prepare(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 501
       )
       INSERT INTO machines
         (id, telemetry_pk, workspace_id, name, description, expected_host, labels_json,
          sampling_interval_seconds, report_interval_seconds, offline_after_seconds,
          container_monitoring_enabled, maintenance_until, desired_config_revision,
          created_at, deleted_at)
       SELECT printf('machine-%03d', value), value, 'workspace-1',
              printf('Machine %03d', value), '', NULL, '{}', 10, 60, 150, 0, NULL, 1, value, NULL
       FROM sequence`,
    ),
    controlDb.prepare(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 501
       )
       INSERT INTO services
         (id, telemetry_pk, workspace_id, name, slug, description, maintenance_until,
          created_at, deleted_at)
       SELECT printf('service-%03d', value), 1000 + value, 'workspace-1',
              printf('Service %03d', value), printf('service-%03d', value), '', NULL, value, NULL
       FROM sequence`,
    ),
    controlDb.prepare(
      `INSERT INTO resource_grants VALUES
        ('workspace-1', 'member-1', 'machine', 'machine-501', 'view', 'allow'),
        ('workspace-1', 'member-1', 'machine', 'machine-500', 'manage', 'allow'),
        ('workspace-1', 'member-1', 'machine', 'machine-500', 'view', 'deny'),
        ('workspace-1', 'member-1', 'service', 'service-501', 'view', 'allow'),
        ('workspace-1', 'member-1', 'service', 'service-501', 'manage', 'allow'),
        ('workspace-1', 'member-1', 'service', 'service-501', 'manage', 'deny'),
        ('workspace-1', 'member-1', 'service', 'service-500', 'manage', 'allow'),
        ('workspace-1', 'member-1', 'service', 'service-500', 'view', 'deny')`,
    ),
  ]);
  await telemetryDb.batch([
    telemetryDb.prepare(
      `CREATE TABLE machine_latest (
        machine_pk INTEGER PRIMARY KEY, observed_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
        state TEXT NOT NULL, cpu_permille INTEGER NOT NULL, memory_used_bytes INTEGER NOT NULL,
        memory_total_bytes INTEGER NOT NULL, storage_used_bytes INTEGER NOT NULL,
        storage_total_bytes INTEGER NOT NULL, network_rx_bps INTEGER NOT NULL,
        network_tx_bps INTEGER NOT NULL, network_rx_total INTEGER NOT NULL,
        network_tx_total INTEGER NOT NULL, load_1m_milli INTEGER, uptime_seconds INTEGER,
        container_inventory_json TEXT
      )`,
    ),
    telemetryDb.prepare(
      `CREATE TABLE service_latest (
        service_pk INTEGER PRIMARY KEY, workspace_pk INTEGER NOT NULL, state TEXT NOT NULL,
        status_since INTEGER NOT NULL, reason_code TEXT NOT NULL,
        last_transition_at INTEGER NOT NULL
      )`,
    ),
    telemetryDb.prepare(
      `CREATE TABLE check_latest (
        check_pk INTEGER PRIMARY KEY, workspace_pk INTEGER NOT NULL, observed_at INTEGER NOT NULL,
        state TEXT NOT NULL, latency_ms INTEGER, failure_code TEXT, failure_summary TEXT,
        consecutive_failures INTEGER NOT NULL, consecutive_successes INTEGER NOT NULL,
        critical INTEGER NOT NULL
      )`,
    ),
    telemetryDb.prepare(
      `CREATE TABLE status_buckets (
        resource_type INTEGER NOT NULL, resource_pk INTEGER NOT NULL,
        workspace_pk INTEGER NOT NULL, bucket_start INTEGER NOT NULL,
        bucket_seconds INTEGER NOT NULL, state TEXT NOT NULL,
        availability_permille INTEGER NOT NULL, latency_avg_ms INTEGER,
        latency_max_ms INTEGER, summary_code TEXT NOT NULL
      )`,
    ),
    telemetryDb.prepare(
      `CREATE TABLE state_events (
        workspace_pk INTEGER NOT NULL, resource_type INTEGER NOT NULL,
        resource_pk INTEGER NOT NULL, occurred_at INTEGER NOT NULL,
        previous_state TEXT NOT NULL, current_state TEXT NOT NULL, reason_code TEXT NOT NULL
      )`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("authorized resource collection bounds", () => {
  it("applies machine and service visibility before collection limits", async () => {
    const [machines, services] = await Promise.all([
      loadMachineCollection(controlDb, telemetryDb, "operations", "member-1"),
      loadServiceCollection(controlDb, telemetryDb, "operations", "member-1"),
    ]);

    expect(machines.machines.map((machine) => machine.id)).toEqual(["machine-501"]);
    expect(services.services.map((service) => service.id)).toEqual(["service-501"]);
  });

  it("keeps authorized resources outside workspace-wide limits on the dashboard", async () => {
    const dashboard = await loadDashboardSnapshot(controlDb, telemetryDb, "operations", "member-1");

    expect(dashboard.summary.machines).toBe(1);
    expect(dashboard.summary.services).toBe(1);
    expect(dashboard.machines.map((machine) => machine.id)).toEqual(["machine-501"]);
    expect(dashboard.services.map((service) => service.id)).toEqual(["service-501"]);
  });

  it("loads an authorized service detail by ID beyond the collection limit", async () => {
    await controlDb.batch(
      Array.from({ length: 51 }, (_, index) =>
        controlDb
          .prepare(
            `INSERT INTO check_configs
             (id, telemetry_pk, workspace_id, service_id, name, kind, executor_kind,
              executor_agent_id, enabled, interval_seconds, timeout_ms, retry_count, critical,
              request_json, secret_refs_json, failure_confirmations, recovery_confirmations, created_at)
             VALUES (?, ?, 'workspace-1', 'service-501', ?, 'http', 'cloudflare', NULL,
                     1, 60, 5000, 0, 0, '{"url":"https://example.com"}', '{}', 1, 1, ?)`,
          )
          .bind(`check-${index + 1}`, 2000 + index, `Check ${index + 1}`, index + 1),
      ),
    );
    const detail = await loadServiceDetail(
      controlDb,
      telemetryDb,
      "operations",
      "member-1",
      "service-501",
    );

    expect(detail.service.id).toBe("service-501");
    expect(detail.service.canManage).toBe(false);
    expect(detail.checks).toHaveLength(50);
    expect(detail.checkPagination).toEqual({ page: 1, pages: 2, total: 51 });

    await controlDb
      .prepare(
        `INSERT INTO check_assertions
         VALUES ('assertion-51', 'check-51', 0, 'body', 'contains', NULL, '"ready"', 'down')`,
      )
      .run();

    const secondPage = await loadServiceDetail(
      controlDb,
      telemetryDb,
      "operations",
      "admin-1",
      "service-501",
      Date.now(),
      { checkPage: 2 },
    );
    expect(secondPage.checks).toHaveLength(1);
    expect(secondPage.checks[0]?.id).toBe("check-51");
    expect(secondPage.checks[0]?.editConfiguration?.assertions).toHaveLength(1);
    expect(secondPage.checkPagination.page).toBe(2);
  });
});
