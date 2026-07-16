import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const config = resolve(repositoryRoot, "packages/db/wrangler.db.template.toml");
const mode = process.argv[2] ?? "validate";

if (mode !== "local" && mode !== "validate") {
  throw new Error("Usage: run-d1-migrations.mjs <local|validate>");
}

const temporary = mode === "validate";
const persistTo = temporary
  ? mkdtempSync(join(tmpdir(), "alphaping-d1-migrations-"))
  : resolve(repositoryRoot, "apps/web/.wrangler/state");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function apply(binding) {
  const result = spawnSync(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      binding,
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`${binding} migration validation failed`);
  }
}

try {
  apply("CONTROL_DB");
  apply("TELEMETRY_DB");
  console.log(`D1 migrations applied (${mode})`);
} finally {
  if (temporary) rmSync(persistTo, { force: true, recursive: true });
}
