import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import {
  BACKUP_DATABASES,
  createBackupManifest,
  validateBackupDirectory,
  writeBackupManifest,
} from "./lib/d1-backup.mjs";

const root = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function usage() {
  return [
    "Usage: d1-backup.mjs --remote --config <real-wrangler-config> --output <directory>",
    "                     [--env <environment>]",
    "",
    "The explicit --remote flag is required. Template configs are rejected.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = { remote: false, config: null, output: null, env: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--remote") options.remote = true;
    else if (argument === "--config" || argument === "--output" || argument === "--env") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value\n${usage()}`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}\n${usage()}`);
    }
  }
  if (!options.remote || !options.config || !options.output) throw new Error(usage());
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: options.capture ? "utf8" : undefined,
    env: { ...process.env, CI: "true" },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : "";
    throw new Error(`${options.label ?? command} failed${detail ? `: ${detail}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function validateRemoteConfig(path) {
  if (!existsSync(path)) throw new Error(`Wrangler config does not exist: ${path}`);
  if (basename(path).includes(".template.")) {
    throw new Error("remote backup requires a real Wrangler config, not a template");
  }
  const source = readFileSync(path, "utf8");
  if (source.includes("00000000-0000-0000-0000-000000000000") || source.includes("-template")) {
    throw new Error("Wrangler config still contains template placeholders");
  }
  for (const database of BACKUP_DATABASES) {
    if (!source.includes(database.binding)) {
      throw new Error(`Wrangler config does not declare ${database.binding}`);
    }
  }

  const repositoryPath = relative(root, path);
  if (!repositoryPath.startsWith("..")) {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", repositoryPath], {
      cwd: root,
      stdio: "ignore",
    });
    if (tracked.status === 0) {
      throw new Error("real Wrangler configs containing D1 IDs must not be tracked by Git");
    }
  }
}

function exportDatabase(database, options, stagingDirectory) {
  const startedAt = new Date().toISOString();
  const output = resolve(stagingDirectory, database.file);
  const args = [
    "exec",
    "wrangler",
    "d1",
    "export",
    database.binding,
    "--remote",
    "--skip-confirmation",
    "--config",
    options.config,
    "--output",
    output,
  ];
  if (options.env) args.push("--env", options.env);
  run(pnpm, args, { label: `${database.binding} export` });
  chmodSync(output, 0o600);
  return { startedAt, completedAt: new Date().toISOString() };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  options.config = resolve(root, options.config);
  options.output = resolve(root, options.output);
  validateRemoteConfig(options.config);
  if (existsSync(options.output))
    throw new Error(`backup output already exists: ${options.output}`);

  const parent = dirname(options.output);
  mkdirSync(parent, { recursive: true });
  const stagingDirectory = mkdtempSync(resolve(parent, ".alphaping-d1-backup-"));
  chmodSync(stagingDirectory, 0o700);

  try {
    console.warn("D1 export temporarily blocks requests to the database being exported.");
    const exports = new Map();
    for (const database of BACKUP_DATABASES) {
      exports.set(database.binding, exportDatabase(database, options, stagingDirectory));
    }
    const manifest = await createBackupManifest(
      stagingDirectory,
      {
        createdAt: new Date().toISOString(),
        gitCommit: run("git", ["rev-parse", "HEAD"], { capture: true, label: "Git lookup" }),
        wranglerVersion: run(pnpm, ["exec", "wrangler", "--version"], {
          capture: true,
          label: "Wrangler version lookup",
        }),
      },
      exports,
    );
    writeBackupManifest(stagingDirectory, manifest);
    await validateBackupDirectory(stagingDirectory);
    renameSync(stagingDirectory, options.output);
    console.log(`Verified D1 backup written to ${options.output}`);
  } catch (error) {
    rmSync(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
