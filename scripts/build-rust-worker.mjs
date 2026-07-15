import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const toolsRoot = resolve(repositoryRoot, "target", "worker-tools");
const executable = resolve(
  toolsRoot,
  "bin",
  process.platform === "win32" ? "worker-build.exe" : "worker-build",
);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status ?? "unknown"}`);
  }
}

if (!existsSync(executable)) {
  mkdirSync(toolsRoot, { recursive: true });
  run("cargo", ["install", "worker-build@0.8.4", "--locked", "--root", toolsRoot], repositoryRoot);
}

run(executable, ["--release"], process.cwd());
