import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const BACKUP_FORMAT_VERSION = 1;

export const BACKUP_DATABASES = Object.freeze([
  Object.freeze({ binding: "TELEMETRY_DB", file: "telemetry.sql" }),
  Object.freeze({ binding: "CONTROL_DB", file: "control.sql" }),
]);

export const RESTORE_PROBES = Object.freeze({
  CONTROL_DB: Object.freeze([
    "installations",
    "user",
    "workspaces",
    "memberships",
    "machines",
    "agents",
    "services",
    "check_configs",
    "resource_grants",
    "retention_policies",
  ]),
  TELEMETRY_DB: Object.freeze([
    "agent_replay_state",
    "telemetry_blocks_5m",
    "machine_latest",
    "machine_rollups_5m",
    "check_result_blocks_5m",
    "check_latest",
    "service_latest",
    "state_events",
    "retention_cursors",
  ]),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function createBackupManifest(directory, metadata, exports) {
  const databases = [];
  for (const database of BACKUP_DATABASES) {
    const timing = exports.get(database.binding);
    if (!timing) throw new Error(`missing export metadata for ${database.binding}`);
    const path = join(directory, database.file);
    const stat = statSync(path);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`${database.file} is not a non-empty file`);
    }
    databases.push({
      binding: database.binding,
      file: database.file,
      bytes: stat.size,
      sha256: await sha256File(path),
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
    });
  }
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: metadata.createdAt,
    source: "remote-d1",
    gitCommit: metadata.gitCommit,
    wranglerVersion: metadata.wranglerVersion,
    databases,
  };
}

export function writeBackupManifest(directory, manifest) {
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function assertManifestShape(manifest) {
  if (!isRecord(manifest) || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`unsupported backup manifest format`);
  }
  if (manifest.source !== "remote-d1") throw new Error("unexpected backup source");
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error("invalid backup creation time");
  }
  if (typeof manifest.gitCommit !== "string" || !/^[0-9a-f]{40}$/.test(manifest.gitCommit)) {
    throw new Error("invalid backup Git commit");
  }
  if (typeof manifest.wranglerVersion !== "string" || manifest.wranglerVersion.length === 0) {
    throw new Error("invalid Wrangler version");
  }
  if (!Array.isArray(manifest.databases) || manifest.databases.length !== BACKUP_DATABASES.length) {
    throw new Error("backup manifest does not contain both D1 databases");
  }
}

export async function validateBackupDirectory(directory) {
  const manifestPath = join(directory, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${basename(manifestPath)}: ${error.message}`, { cause: error });
  }
  assertManifestShape(manifest);

  const entries = new Map();
  for (const entry of manifest.databases) {
    if (!isRecord(entry) || typeof entry.binding !== "string") {
      throw new Error("invalid database manifest entry");
    }
    if (entries.has(entry.binding)) throw new Error(`duplicate database entry: ${entry.binding}`);
    entries.set(entry.binding, entry);
  }

  for (const expected of BACKUP_DATABASES) {
    const entry = entries.get(expected.binding);
    if (!entry || entry.file !== expected.file) {
      throw new Error(`missing expected backup file for ${expected.binding}`);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
      throw new Error(`invalid byte count for ${expected.binding}`);
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`invalid SHA-256 for ${expected.binding}`);
    }
    if (
      typeof entry.startedAt !== "string" ||
      typeof entry.completedAt !== "string" ||
      Number.isNaN(Date.parse(entry.startedAt)) ||
      Number.isNaN(Date.parse(entry.completedAt))
    ) {
      throw new Error(`invalid export timing for ${expected.binding}`);
    }

    const path = join(directory, expected.file);
    const stat = statSync(path);
    if (!stat.isFile() || stat.size !== entry.bytes) {
      throw new Error(`size mismatch for ${expected.file}`);
    }
    if ((await sha256File(path)) !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${expected.file}`);
    }
  }
  return manifest;
}

export function buildRestoreProbe(tables) {
  const identifiers = tables.map((table) => `"${table}"`).join(", ");
  const probes = tables.map((table) => `SELECT 1 FROM "${table}" LIMIT 1;`).join("\n");
  return [
    "PRAGMA quick_check;",
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${identifiers});`,
    probes,
  ].join("\n");
}
