import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const steps = [
  ["format", pnpm, ["format:check"]],
  ["lint", pnpm, ["lint"]],
  ["typecheck", pnpm, ["typecheck"]],
  ["tests", pnpm, ["test"]],
  ["D1 migrations", pnpm, ["db:validate"]],
  ["D1 schema manifest", pnpm, ["db:generate:check"]],
  ["cost model", pnpm, ["cost:check"]],
  ["Rust format", "node", ["scripts/run-cargo.mjs", "fmt", "--all", "--check"]],
  [
    "Rust lint",
    "node",
    [
      "scripts/run-cargo.mjs",
      "clippy",
      "--workspace",
      "--all-targets",
      "--all-features",
      "--",
      "-D",
      "warnings",
    ],
  ],
  ["Rust tests", "node", ["scripts/run-cargo.mjs", "test", "--workspace"]],
  ["Agent resources", "node", ["scripts/check-agent-resources.mjs"]],
  ["build", pnpm, ["build"]],
  ["web E2E", "node", ["scripts/test-web-e2e.mjs", "--skip-build"]],
  ["Worker dry-run", pnpm, ["workers:deploy", "--all", "--env", "production", "--dry-run"]],
  ["whitespace", "git", ["diff", "--check"]],
];

for (const [label, command, args] of steps) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { env: process.env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nAlphaPing verification passed");
