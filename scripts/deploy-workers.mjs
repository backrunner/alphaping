import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const deployableRoots = [resolve(root, "workers"), resolve(root, "apps")];
const WORKER_PATTERN = /^wrangler\.([a-z0-9-]+)\.template\.toml$/;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

function discoverWorkers() {
  const workers = [];
  for (const deployableRoot of deployableRoots) {
    for (const directory of readdirSync(deployableRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const workerDirectory = resolve(deployableRoot, directory.name);
      for (const file of readdirSync(workerDirectory)) {
        const match = WORKER_PATTERN.exec(file);
        if (!match?.[1]) continue;
        workers.push({
          name: match[1],
          directory: workerDirectory,
          template: resolve(workerDirectory, file),
          local: resolve(workerDirectory, `wrangler.${match[1]}.toml`),
        });
      }
    }
  }
  return workers.sort((left, right) => left.name.localeCompare(right.name));
}

function parseArguments(argv) {
  const options = { all: false, dryRun: false, list: false, env: "production", workers: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") options.all = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--worker") {
      const value = argv[index + 1];
      if (!value) throw new Error("--worker requires a name");
      options.workers.push(value);
      index += 1;
    } else if (argument === "--env") {
      const value = argv[index + 1];
      if (value !== "local" && value !== "production") {
        throw new Error("--env must be local or production");
      }
      options.env = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function validateProductionConfig(worker, configPath) {
  const config = readFileSync(configPath, "utf8");
  const placeholderRateLimitNamespace = [
    "1001",
    "1002",
    "1003",
    "1004",
    "1005",
    "1010",
    "1011",
  ].some((namespace) => config.includes(`namespace_id = "${namespace}"`));
  if (
    config.includes("-template") ||
    config.includes("00000000-0000-0000-0000-000000000000") ||
    placeholderRateLimitNamespace ||
    !config.includes(`name = "alphaping-${worker.name}-production"`)
  ) {
    throw new Error(
      `${basename(configPath)} still contains placeholders or an unsafe production name`,
    );
  }
}

function deploy(worker, options) {
  const useTemplate = options.dryRun && !existsSync(worker.local);
  const config = useTemplate ? worker.template : worker.local;
  if (!existsSync(config)) {
    throw new Error(
      `missing ${basename(worker.local)}; copy and edit ${basename(worker.template)}`,
    );
  }
  if (!options.dryRun && options.env === "production") validateProductionConfig(worker, config);

  const command = ["exec", "wrangler", "deploy", "--config", basename(config)];
  command.push(options.env === "production" ? "--env=production" : "--env=");
  if (options.dryRun) command.push("--dry-run");
  if (existsSync(resolve(worker.directory, "svelte.config.js"))) {
    const build = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["exec", "vite", "build"],
      {
        cwd: worker.directory,
        stdio: "inherit",
        env: process.env,
      },
    );
    if (build.status !== 0) throw new Error(`${worker.name} build failed before deployment`);
  }
  const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", command, {
    cwd: worker.directory,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) throw new Error(`${worker.name} deploy command failed`);
}

const available = discoverWorkers();
const options = parseArguments(process.argv.slice(2));
if (options.list) {
  for (const worker of available) {
    const state = existsSync(worker.local) ? "configured" : "template only";
    console.log(`${worker.name}\t${state}\t${worker.directory.replace(`${root}/`, "")}`);
  }
  process.exit(0);
}
const requested = options.all ? available.map((worker) => worker.name) : options.workers;
if (requested.length === 0) throw new Error("select --all or at least one --worker <name>");
for (const name of requested) {
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe worker name: ${name}`);
  const worker = available.find((candidate) => candidate.name === name);
  if (!worker) throw new Error(`unknown worker: ${name}`);
  deploy(worker, options);
}
