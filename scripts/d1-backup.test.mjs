import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import {
  BACKUP_DATABASES,
  RESTORE_PROBES,
  createBackupManifest,
  validateBackupDirectory,
  writeBackupManifest,
} from "./lib/d1-backup.mjs";

const root = resolve(import.meta.dirname, "..");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

async function createSyntheticBackup() {
  const directory = mkdtempSync(join(tmpdir(), "alphaping-d1-backup-test-"));
  temporaryDirectories.push(directory);
  const exports = new Map();
  const startedAt = "2026-07-17T00:00:00.000Z";
  const completedAt = "2026-07-17T00:00:01.000Z";

  for (const database of BACKUP_DATABASES) {
    const tables = RESTORE_PROBES[database.binding];
    const sql = tables.map((table) => `CREATE TABLE "${table}" (id INTEGER);`).join("\n");
    writeFileSync(join(directory, database.file), `${sql}\n`, { mode: 0o600 });
    exports.set(database.binding, { startedAt, completedAt });
  }

  const manifest = await createBackupManifest(
    directory,
    {
      createdAt: completedAt,
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      wranglerVersion: "4.111.0",
    },
    exports,
  );
  writeBackupManifest(directory, manifest);
  return directory;
}

test("restores synthetic CONTROL_DB and TELEMETRY_DB backups locally", async () => {
  const backup = await createSyntheticBackup();
  const result = spawnSync("node", ["scripts/d1-restore-verify.mjs", "--backup", backup], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /restored into fresh local databases and verified/);
});

test("rejects a backup whose SQL file no longer matches its manifest", async () => {
  const backup = await createSyntheticBackup();
  const path = join(backup, "telemetry.sql");
  const sql = readFileSync(path);
  sql[0] ^= 1;
  writeFileSync(path, sql);
  await assert.rejects(validateBackupDirectory(backup), /SHA-256 mismatch/);
});

test("rejects a template config before attempting a remote export", () => {
  const output = join(tmpdir(), `alphaping-should-not-exist-${process.pid}`);
  rmSync(output, { force: true, recursive: true });
  const result = spawnSync(
    "node",
    [
      "scripts/d1-backup.mjs",
      "--remote",
      "--config",
      "packages/db/wrangler.db.template.toml",
      "--output",
      output,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a real Wrangler config/);
  assert.equal(existsSync(output), false);
  assert.equal(result.stdout, "");
});
