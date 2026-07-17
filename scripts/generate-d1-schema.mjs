import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, "packages/db/wrangler.db.template.toml");
const output = resolve(root, "packages/db/schema-manifest.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const mode = process.argv[2] ?? "write";
if (mode !== "write" && mode !== "check") {
  throw new Error("Usage: generate-d1-schema.mjs <write|check>");
}

const databases = [
  { binding: "CONTROL_DB", migrations: "packages/db/migrations/control" },
  { binding: "TELEMETRY_DB", migrations: "packages/db/migrations/telemetry" },
];
const schemaQuery = `SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE sql IS NOT NULL
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '_cf_%'
  AND name != 'd1_migrations'
ORDER BY type, name`;

function runWrangler(args, options = {}) {
  const buffered = options.capture || options.quiet;
  const result = spawnSync(pnpm, ["exec", "wrangler", ...args], {
    cwd: root,
    encoding: buffered ? "utf8" : undefined,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
    stdio: buffered ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw new Error("Wrangler could not start", { cause: result.error });
  if (result.status !== 0) {
    throw new Error(
      `${options.label ?? "Wrangler command"} failed: ${result.stderr?.trim() ?? ""}`,
    );
  }
  return options.capture ? result.stdout : "";
}

function migrationFiles(directory) {
  return readdirSync(resolve(root, directory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((file) => {
      const bytes = readFileSync(resolve(root, directory, file));
      return {
        file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
}

function parseQueryResult(outputText, binding) {
  let value;
  try {
    value = JSON.parse(outputText);
  } catch (error) {
    throw new Error(`Wrangler returned invalid JSON for ${binding}`, { cause: error });
  }
  const result = Array.isArray(value) ? value[0] : null;
  if (!result?.success || !Array.isArray(result.results)) {
    throw new Error(`Wrangler omitted schema rows for ${binding}`);
  }
  return result.results.map((row) => ({
    type: String(row.type),
    name: String(row.name),
    table: String(row.tbl_name),
    sql: String(row.sql),
  }));
}

const persistTo = mkdtempSync(join(tmpdir(), "alphaping-d1-schema-"));
try {
  const manifest = { formatVersion: 1, databases: {} };
  for (const database of databases) {
    runWrangler(
      [
        "d1",
        "migrations",
        "apply",
        database.binding,
        "--local",
        "--config",
        config,
        "--persist-to",
        persistTo,
      ],
      { label: `${database.binding} migrations`, quiet: true },
    );
    const queryOutput = runWrangler(
      [
        "d1",
        "execute",
        database.binding,
        "--local",
        "--config",
        config,
        "--persist-to",
        persistTo,
        "--command",
        schemaQuery,
        "--json",
      ],
      { capture: true, label: `${database.binding} schema query` },
    );
    manifest.databases[database.binding] = {
      migrations: migrationFiles(database.migrations),
      objects: parseQueryResult(queryOutput, database.binding),
    };
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (mode === "write") {
    writeFileSync(output, serialized, "utf8");
    console.log("Generated packages/db/schema-manifest.json");
  } else if (readFileSync(output, "utf8") !== serialized) {
    throw new Error("D1 schema manifest is stale; run pnpm db:generate");
  } else {
    console.log("D1 schema manifest matches all migrations");
  }
} finally {
  rmSync(persistTo, { force: true, recursive: true });
}
