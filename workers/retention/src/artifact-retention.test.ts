import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  acquirePrefixLease,
  ARTIFACT_EXPIRY_METADATA,
  cleanArtifactBucket,
  releasePrefixLease,
} from "./artifact-retention";

const NOW = 1_752_580_800_000;

async function clearBucket(): Promise<void> {
  const listed = await env.EXPORT_BUCKET.list({ limit: 1_000 });
  if (listed.objects.length > 0) {
    await env.EXPORT_BUCKET.delete(listed.objects.map(({ key }) => key));
  }
}

beforeEach(async () => {
  await clearBucket();
  await env.TELEMETRY_DB.batch([
    env.TELEMETRY_DB.prepare("DROP TABLE IF EXISTS artifact_retention_cursors"),
    env.TELEMETRY_DB.prepare(
      `CREATE TABLE artifact_retention_cursors (
        prefix TEXT PRIMARY KEY NOT NULL,
        last_key TEXT NOT NULL DEFAULT '',
        lease_until INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
    ),
  ]);
});

describe("R2 artifact retention", () => {
  it("resumes bounded scans and deletes only explicitly expired artifacts", async () => {
    const expired = { customMetadata: { [ARTIFACT_EXPIRY_METADATA]: String(NOW - 1) } };
    const future = { customMetadata: { [ARTIFACT_EXPIRY_METADATA]: String(NOW + 60_000) } };
    await Promise.all([
      env.EXPORT_BUCKET.put("exports/v1/a-expired.json", "expired", expired),
      env.EXPORT_BUCKET.put("exports/v1/z-future.json", "future", future),
      env.EXPORT_BUCKET.put("backups/v1/a-expired.sql", "expired", expired),
      env.EXPORT_BUCKET.put("backups/v1/z-no-expiry.sql", "preserve"),
      env.EXPORT_BUCKET.put(
        "telemetry/v1/never-scan.bin",
        "online telemetry must be ignored",
        expired,
      ),
    ]);

    await expect(cleanArtifactBucket(env, NOW, 1)).resolves.toEqual({
      scanned: 2,
      deleted: 2,
      skippedPrefixes: 0,
    });
    const cursors = await env.TELEMETRY_DB.prepare(
      "SELECT prefix, last_key FROM artifact_retention_cursors ORDER BY prefix",
    ).all<{ prefix: string; last_key: string }>();
    expect(cursors.results).toEqual([
      { prefix: "backups/v1/", last_key: "backups/v1/a-expired.sql" },
      { prefix: "exports/v1/", last_key: "exports/v1/a-expired.json" },
    ]);

    await expect(cleanArtifactBucket(env, NOW, 1)).resolves.toEqual({
      scanned: 2,
      deleted: 0,
      skippedPrefixes: 0,
    });
    await expect(cleanArtifactBucket(env, NOW, 1)).resolves.toEqual({
      scanned: 2,
      deleted: 0,
      skippedPrefixes: 0,
    });

    const remaining = await env.EXPORT_BUCKET.list({ limit: 1_000 });
    expect(remaining.objects.map(({ key }) => key).sort()).toEqual([
      "backups/v1/z-no-expiry.sql",
      "exports/v1/z-future.json",
      "telemetry/v1/never-scan.bin",
    ]);
  });

  it("does not overlap a prefix while its lease is active", async () => {
    await env.TELEMETRY_DB.prepare(
      `INSERT INTO artifact_retention_cursors (prefix, last_key, lease_until, updated_at)
       VALUES ('exports/v1/', '', ?, ?)`,
    )
      .bind(NOW + 1_000, NOW)
      .run();

    await expect(cleanArtifactBucket(env, NOW)).resolves.toEqual({
      scanned: 0,
      deleted: 0,
      skippedPrefixes: 1,
    });
  });

  it("prevents a stale lease holder from overwriting a replacement cursor", async () => {
    const first = await acquirePrefixLease(env.TELEMETRY_DB, "exports/v1/", NOW);
    if (!first) throw new Error("missing first artifact lease");
    const replacementLeaseUntil = first.leaseUntil + 5 * 60_000;
    await env.TELEMETRY_DB.prepare(
      `UPDATE artifact_retention_cursors
       SET last_key = 'exports/v1/replacement', lease_until = ?
       WHERE prefix = 'exports/v1/'`,
    )
      .bind(replacementLeaseUntil)
      .run();

    await expect(
      releasePrefixLease(
        env.TELEMETRY_DB,
        "exports/v1/",
        "exports/v1/stale",
        first.leaseUntil,
        NOW + 1,
      ),
    ).rejects.toThrow("artifact_retention_lease_lost");
    const cursor = await env.TELEMETRY_DB.prepare(
      "SELECT last_key, lease_until FROM artifact_retention_cursors WHERE prefix = 'exports/v1/'",
    ).first<{ last_key: string; lease_until: number }>();
    expect(cursor).toEqual({
      last_key: "exports/v1/replacement",
      lease_until: replacementLeaseUntil,
    });
  });
});
