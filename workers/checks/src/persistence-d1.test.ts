import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { d1BlobToArrayBuffer } from "@alphaping/contracts";

import { persistCheckResult } from "./persistence.js";
import type { CheckConfigRow } from "./types.js";

let miniflare: Miniflare;
let database: D1Database;

const staleConfig: CheckConfigRow = {
  id: "check-1",
  telemetry_pk: 1,
  workspace_telemetry_pk: 1,
  workspace_id: "workspace-1",
  service_telemetry_pk: 10,
  service_maintenance_until: null,
  config_revision: 1,
  kind: "http",
  interval_seconds: 60,
  phase_seconds: 0,
  timeout_ms: 1_000,
  retry_count: 0,
  critical: 1,
  request_json: "{}",
  secret_refs_json: "{}",
  failure_confirmations: 1,
  recovery_confirmations: 1,
  last_claimed_slot: 0,
};

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { TELEMETRY_DB: "telemetry-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("TELEMETRY_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE check_result_blocks_5m (
        check_pk INTEGER NOT NULL, workspace_pk INTEGER NOT NULL, block_start INTEGER NOT NULL,
        result_0 BLOB, result_id_0 BLOB, payload_hash_0 BLOB,
        result_1 BLOB, result_id_1 BLOB, payload_hash_1 BLOB,
        result_2 BLOB, result_id_2 BLOB, payload_hash_2 BLOB,
        result_3 BLOB, result_id_3 BLOB, payload_hash_3 BLOB,
        result_4 BLOB, result_id_4 BLOB, payload_hash_4 BLOB,
        schema_version INTEGER NOT NULL, flags INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (check_pk, block_start)
      ) WITHOUT ROWID`,
    ),
    database.prepare(
      `CREATE TABLE check_latest (
        check_pk INTEGER PRIMARY KEY, workspace_pk INTEGER NOT NULL, service_pk INTEGER,
        observed_at INTEGER NOT NULL, state TEXT NOT NULL, latency_ms INTEGER,
        failure_code TEXT, failure_summary TEXT, consecutive_failures INTEGER NOT NULL,
        consecutive_successes INTEGER NOT NULL, critical INTEGER NOT NULL,
        config_revision INTEGER NOT NULL, result_id BLOB NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE service_latest (
        service_pk INTEGER PRIMARY KEY, workspace_pk INTEGER NOT NULL, state TEXT NOT NULL,
        status_since INTEGER NOT NULL, reason_code TEXT NOT NULL,
        last_transition_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE state_events (
        workspace_pk INTEGER NOT NULL, resource_type INTEGER NOT NULL,
        resource_pk INTEGER NOT NULL, occurred_at INTEGER NOT NULL, event_id BLOB NOT NULL,
        previous_state TEXT NOT NULL, current_state TEXT NOT NULL, reason_code TEXT NOT NULL,
        PRIMARY KEY (resource_type, resource_pk, occurred_at, event_id)
      ) WITHOUT ROWID`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

function synchronizeBatches(db: D1Database, expected: number): D1Database {
  let waiting = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return new Proxy(db, {
    get(target, property) {
      if (property !== "batch") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (statements: D1PreparedStatement[]) => {
        waiting += 1;
        if (waiting === expected) release?.();
        await ready;
        return target.batch(statements);
      };
    },
  });
}

describe("central check revision fencing", () => {
  it("creates service latest and an event from the first committed result", async () => {
    await persistCheckResult(database, staleConfig, 60_000, 1_000, {
      state: "healthy",
      latencyMs: 10,
      failureCode: null,
      failureSummary: null,
    });

    await expect(
      database
        .prepare("SELECT state, reason_code FROM service_latest WHERE service_pk = 10")
        .first(),
    ).resolves.toEqual({ state: "healthy", reason_code: "check_healthy" });
    await expect(
      database
        .prepare(
          `SELECT previous_state, current_state, reason_code FROM state_events
           WHERE resource_type = 2 AND resource_pk = 10`,
        )
        .first(),
    ).resolves.toEqual({
      previous_state: "unknown",
      current_state: "healthy",
      reason_code: "check_healthy",
    });
  });

  it("does not let an old result overwrite a newer latest or service state", async () => {
    let injected = false;
    const racingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!injected) {
              injected = true;
              await target.batch([
                target
                  .prepare(
                    `INSERT INTO check_latest
                      (check_pk, workspace_pk, service_pk, observed_at, state, latency_ms,
                       failure_code, failure_summary, consecutive_failures,
                       consecutive_successes, critical, config_revision, result_id)
                     VALUES (1, 1, 10, 2000, 'healthy', 10, NULL, NULL, 0, 1, 1, 2, ?)`,
                  )
                  .bind(new Uint8Array([2]).buffer),
                target.prepare(
                  `INSERT INTO service_latest
                    (service_pk, workspace_pk, state, status_since, reason_code,
                     last_transition_at, updated_at)
                   VALUES (10, 1, 'healthy', 2000, 'check_healthy', 2000, 2000)`,
                ),
              ]);
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await persistCheckResult(racingDatabase, staleConfig, 60_000, 3_000, {
      state: "down",
      latencyMs: null,
      failureCode: "timeout",
      failureSummary: null,
    });

    await expect(
      database
        .prepare("SELECT state, config_revision FROM check_latest WHERE check_pk = 1")
        .first(),
    ).resolves.toEqual({ state: "healthy", config_revision: 2 });
    await expect(
      database.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "healthy" });
    const raw = await database
      .prepare("SELECT result_id_1 FROM check_result_blocks_5m WHERE check_pk = 1")
      .first<{ result_id_1: unknown }>();
    if (!raw) throw new Error("stale raw result was not retained");
    const legacyId = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("check-1:60000"),
    );
    expect([...new Uint8Array(d1BlobToArrayBuffer(raw.result_id_1))]).toEqual([
      ...new Uint8Array(legacyId),
    ]);
  });

  it("recomputes a service from committed latest rows after concurrent check changes", async () => {
    await database.batch([
      database
        .prepare(
          `INSERT INTO check_latest
            (check_pk, workspace_pk, service_pk, observed_at, state, latency_ms,
             failure_code, failure_summary, consecutive_failures,
             consecutive_successes, critical, config_revision, result_id)
           VALUES (1, 1, 10, 1000, 'down', NULL, 'timeout', NULL, 1, 0, 1, 1, ?),
                  (2, 1, 10, 1000, 'healthy', 10, NULL, NULL, 0, 1, 1, 1, ?)`,
        )
        .bind(new Uint8Array([1]).buffer, new Uint8Array([2]).buffer),
      database.prepare(
        `INSERT INTO service_latest
          (service_pk, workspace_pk, state, status_since, reason_code,
           last_transition_at, updated_at)
         VALUES (10, 1, 'down', 1000, 'check_down', 1000, 1000)`,
      ),
    ]);
    const synchronized = synchronizeBatches(database, 2);

    await Promise.all([
      persistCheckResult(synchronized, staleConfig, 60_000, 2_000, {
        state: "healthy",
        latencyMs: 10,
        failureCode: null,
        failureSummary: null,
      }),
      persistCheckResult(
        synchronized,
        { ...staleConfig, id: "check-2", telemetry_pk: 2 },
        60_000,
        2_000,
        {
          state: "down",
          latencyMs: null,
          failureCode: "timeout",
          failureSummary: null,
        },
      ),
    ]);

    await expect(
      database.prepare("SELECT check_pk, state FROM check_latest ORDER BY check_pk").all(),
    ).resolves.toMatchObject({
      results: [
        { check_pk: 1, state: "healthy" },
        { check_pk: 2, state: "down" },
      ],
    });
    await expect(
      database.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "down" });
  });

  it("does not replay an ignored event over a later service transition", async () => {
    await database.batch([
      database
        .prepare(
          `INSERT INTO check_latest
            (check_pk, workspace_pk, service_pk, observed_at, state, latency_ms,
             failure_code, failure_summary, consecutive_failures,
             consecutive_successes, critical, config_revision, result_id)
           VALUES (1, 1, 10, 1000, 'down', NULL, 'timeout', NULL, 1, 0, 1, 1, ?),
                  (2, 1, 10, 1000, 'healthy', 10, NULL, NULL, 0, 1, 1, 1, ?)`,
        )
        .bind(new Uint8Array([1]).buffer, new Uint8Array([2]).buffer),
      database.prepare(
        `INSERT INTO service_latest
          (service_pk, workspace_pk, state, status_since, reason_code,
           last_transition_at, updated_at)
         VALUES (10, 1, 'down', 1000, 'check_down', 1000, 1000)`,
      ),
    ]);
    let replayed = false;
    const replayingDatabase = new Proxy(database, {
      get(target, property) {
        if (property !== "batch") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (!replayed) {
            replayed = true;
            await persistCheckResult(
              target,
              { ...staleConfig, id: "check-2", telemetry_pk: 2 },
              60_000,
              2_000,
              {
                state: "down",
                latencyMs: null,
                failureCode: "timeout",
                failureSummary: null,
              },
            );
            await target.batch(statements);
          }
          return result;
        };
      },
    });

    await persistCheckResult(replayingDatabase, staleConfig, 60_000, 2_000, {
      state: "healthy",
      latencyMs: 10,
      failureCode: null,
      failureSummary: null,
    });

    await expect(
      database.prepare("SELECT state FROM service_latest WHERE service_pk = 10").first(),
    ).resolves.toEqual({ state: "down" });
  });
});
