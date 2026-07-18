import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import schemaManifest from "../../schema-manifest.json";

let miniflare: Miniflare;
let database: D1Database;

function triggerSql(name: string): string {
  const trigger = schemaManifest.databases.CONTROL_DB.objects.find(
    (object) => object.type === "trigger" && object.name === name,
  );
  if (!trigger) throw new Error(`missing schema trigger: ${name}`);
  return trigger.sql;
}

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
      `CREATE TABLE check_configs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, request_json TEXT NOT NULL,
        secret_refs_json TEXT NOT NULL, config_bytes INTEGER NOT NULL,
        enabled INTEGER NOT NULL, interval_seconds INTEGER NOT NULL,
        phase_seconds INTEGER NOT NULL, timeout_ms INTEGER NOT NULL,
        retry_count INTEGER NOT NULL, critical INTEGER NOT NULL,
        failure_confirmations INTEGER NOT NULL, recovery_confirmations INTEGER NOT NULL,
        config_revision INTEGER NOT NULL, last_claimed_slot INTEGER NOT NULL
      )`,
    ),
    database.prepare(triggerSql("check_configs_config_revision_monotonic")),
    database.prepare(triggerSql("check_configs_config_revision_compat")),
    database.prepare(
      `INSERT INTO check_configs VALUES
        ('check-1', 'Check', '{}', '{}', 512, 1, 60, 0, 5000, 0, 1, 2, 2, 1, 0)`,
    ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

async function revision(): Promise<number | null> {
  const row = await database
    .prepare("SELECT config_revision FROM check_configs WHERE id = 'check-1'")
    .first<{ config_revision: number }>();
  return row?.config_revision ?? null;
}

describe("check configuration revision triggers", () => {
  it("fences old writers without incrementing scheduler or new-writer updates twice", async () => {
    await database
      .prepare('UPDATE check_configs SET request_json = \'{"url":"https://old.test"}\'')
      .run();
    await expect(revision()).resolves.toBe(2);

    await database.prepare("UPDATE check_configs SET last_claimed_slot = 60").run();
    await expect(revision()).resolves.toBe(2);

    await database
      .prepare(
        `UPDATE check_configs
         SET request_json = '{"url":"https://new.test"}',
             config_revision = config_revision + 1`,
      )
      .run();
    await expect(revision()).resolves.toBe(3);

    await expect(
      database.prepare("UPDATE check_configs SET config_revision = 2").run(),
    ).rejects.toThrow("check config revision must increase");
    await expect(revision()).resolves.toBe(3);
  });
});
