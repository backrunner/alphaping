import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BACKUP_DATABASES,
  RESTORE_PROBES,
  buildRestoreProbe,
  validateBackupDirectory,
} from "./lib/d1-backup.mjs";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, "packages/db/wrangler.db.template.toml");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--backup" || !argv[1]) {
    throw new Error("Usage: d1-restore-verify.mjs --backup <backup-directory>");
  }
  return { backup: resolve(root, argv[1]) };
}

function runWrangler(binding, args, persistTo, label) {
  const result = spawnSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      binding,
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
      ...args,
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error(`${label} failed`);
}

async function main() {
  const { backup } = parseArguments(process.argv.slice(2));
  await validateBackupDirectory(backup);
  const persistTo = mkdtempSync(join(tmpdir(), "alphaping-d1-restore-"));

  try {
    for (const database of BACKUP_DATABASES) {
      runWrangler(
        database.binding,
        ["--file", join(backup, database.file)],
        persistTo,
        `${database.binding} restore`,
      );
      runWrangler(
        database.binding,
        ["--command", buildRestoreProbe(RESTORE_PROBES[database.binding])],
        persistTo,
        `${database.binding} integrity probe`,
      );
    }
    console.log("D1 backup restored into fresh local databases and verified");
  } finally {
    rmSync(persistTo, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
