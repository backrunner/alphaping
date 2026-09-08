import { existsSync, mkdirSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const toolsRoot = resolve(repositoryRoot, "target", "worker-tools");
const workerBuildVersion = "0.8.5";
const executable = resolve(
  toolsRoot,
  "bin",
  process.platform === "win32" ? "worker-build.exe" : "worker-build",
);

function rustBuildEnvironment() {
  const rustc = spawnSync("rustup", ["which", "rustc"], {
    encoding: "utf8",
    env: process.env,
  });
  if (rustc.status !== 0 || !rustc.stdout.trim()) return process.env;

  const toolchainBin = dirname(rustc.stdout.trim());
  const environment = {
    ...process.env,
    PATH: `${toolchainBin}${delimiter}${process.env.PATH ?? ""}`,
  };
  const installedTargets = spawnSync("rustup", ["target", "list", "--installed"], {
    encoding: "utf8",
    env: environment,
  });
  return installedTargets.status === 0 &&
    installedTargets.stdout.split(/\r?\n/).includes("wasm32-unknown-unknown")
    ? environment
    : process.env;
}

const buildEnvironment = rustBuildEnvironment();

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: buildEnvironment, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status ?? "unknown"}`);
  }
}

const installedVersion = existsSync(executable)
  ? spawnSync(executable, ["--version"], { encoding: "utf8", env: buildEnvironment })
  : undefined;
if (installedVersion?.status !== 0 || installedVersion.stdout.trim() !== workerBuildVersion) {
  mkdirSync(toolsRoot, { recursive: true });
  run(
    "cargo",
    ["install", `worker-build@${workerBuildVersion}`, "--locked", "--root", toolsRoot],
    repositoryRoot,
  );
}

run(executable, ["--release"], process.cwd());
