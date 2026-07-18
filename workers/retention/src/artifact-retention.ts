export const ARTIFACT_EXPIRY_METADATA = "alphaping-expires-at-ms";

const ARTIFACT_PREFIXES = ["exports/v1/", "backups/v1/"] as const;
const LIST_BATCH = 500;
const LEASE_MS = 5 * 60_000;

type ArtifactPrefix = (typeof ARTIFACT_PREFIXES)[number];

interface CursorRow {
  last_key: string;
}

export interface ArtifactPrefixLease {
  lastKey: string;
  leaseUntil: number;
}

export interface ArtifactCleanupResult {
  scanned: number;
  deleted: number;
  skippedPrefixes: number;
}

function expiredAt(object: R2Object, now: number): boolean {
  const raw = object.customMetadata?.[ARTIFACT_EXPIRY_METADATA];
  if (!raw || !/^\d{1,16}$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= now;
}

export async function acquirePrefixLease(
  db: D1Database,
  prefix: ArtifactPrefix,
  now: number,
): Promise<ArtifactPrefixLease | null> {
  const leaseUntil = now + LEASE_MS;
  const cursor = await db
    .prepare(
      `INSERT INTO artifact_retention_cursors
         (prefix, last_key, lease_until, updated_at)
       VALUES (?, '', ?, ?)
       ON CONFLICT(prefix) DO UPDATE SET
         lease_until = excluded.lease_until,
         updated_at = excluded.updated_at
       WHERE artifact_retention_cursors.lease_until <= ?
       RETURNING last_key`,
    )
    .bind(prefix, leaseUntil, now, now)
    .first<CursorRow>();
  return cursor ? { lastKey: cursor.last_key, leaseUntil } : null;
}

export async function releasePrefixLease(
  db: D1Database,
  prefix: ArtifactPrefix,
  lastKey: string,
  leaseUntil: number,
  now: number,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE artifact_retention_cursors
       SET last_key = ?, lease_until = 0, updated_at = ?
       WHERE prefix = ? AND lease_until = ?`,
    )
    .bind(lastKey, now, prefix, leaseUntil)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new Error("artifact_retention_lease_lost");
}

async function cleanPrefix(
  env: Env,
  prefix: ArtifactPrefix,
  now: number,
  limit: number,
): Promise<{ scanned: number; deleted: number; skipped: boolean }> {
  const cursor = await acquirePrefixLease(env.TELEMETRY_DB, prefix, now);
  if (!cursor) return { scanned: 0, deleted: 0, skipped: true };

  const listed = await env.EXPORT_BUCKET.list({
    prefix,
    ...(cursor.lastKey ? { startAfter: cursor.lastKey } : {}),
    limit,
    include: ["customMetadata"],
  });
  const expiredKeys = listed.objects
    .filter((object) => expiredAt(object, now))
    .map(({ key }) => key);
  if (expiredKeys.length > 0) await env.EXPORT_BUCKET.delete(expiredKeys);

  const finalKey = listed.objects.at(-1)?.key ?? "";
  const nextKey = listed.truncated && finalKey ? finalKey : "";
  await releasePrefixLease(env.TELEMETRY_DB, prefix, nextKey, cursor.leaseUntil, now);
  return { scanned: listed.objects.length, deleted: expiredKeys.length, skipped: false };
}

export async function cleanArtifactBucket(
  env: Env,
  now: number,
  limit = LIST_BATCH,
): Promise<ArtifactCleanupResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("artifact list batch must be between 1 and 1000");
  }
  const result: ArtifactCleanupResult = { scanned: 0, deleted: 0, skippedPrefixes: 0 };
  for (const prefix of ARTIFACT_PREFIXES) {
    const prefixResult = await cleanPrefix(env, prefix, now, limit);
    result.scanned += prefixResult.scanned;
    result.deleted += prefixResult.deleted;
    result.skippedPrefixes += Number(prefixResult.skipped);
  }
  return result;
}
