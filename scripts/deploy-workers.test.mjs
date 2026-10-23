import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("deployment discovery includes the documentation site, Web control plane and background Workers", () => {
  const result = spawnSync(process.execPath, ["scripts/deploy-workers.mjs", "--list"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const workers = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split("\t"));
  assert.deepEqual(
    workers.map(([name]) => name),
    ["checks", "docs", "ingest", "live", "notifications", "retention", "web"],
  );
  assert.equal(workers.find(([name]) => name === "web")[2], "apps/web");
  assert.equal(workers.find(([name]) => name === "docs")[2], "apps/docs");
});

test("SvelteKit deployment builds current assets and stops on a failed build", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "alphaping-deploy-test-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "apps", "docs");
  const bin = join(root, "bin");
  for (const directory of [app, bin, join(root, "scripts"), join(root, "workers")]) {
    mkdirSync(directory, { recursive: true });
  }
  copyFileSync(
    new URL("./deploy-workers.mjs", import.meta.url),
    join(root, "scripts", "deploy-workers.mjs"),
  );
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({ devDependencies: { "@sveltejs/kit": "3.1.0" } }),
  );
  writeFileSync(join(app, "vite.config.ts"), "export default {};\n");
  for (const name of ["wrangler.docs.template.toml", "wrangler.docs.toml"]) {
    writeFileSync(join(app, name), 'name = "alphaping-docs-production"\n');
  }
  const callsFile = join(root, "calls.jsonl");
  const stub = join(bin, "pnpm-stub.cjs");
  writeFileSync(
    stub,
    `
const { appendFileSync, existsSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.ALPHAPING_DEPLOY_TEST_CALLS, JSON.stringify({ args, cwd: process.cwd(), origin: process.env.DOCS_SITE_URL }) + "\\n");
if (args[1] === "vite") {
  if (process.env.ALPHAPING_DEPLOY_TEST_FAIL_BUILD === "1") process.exit(9);
  writeFileSync("built-assets", "fresh");
} else if (!existsSync("built-assets")) {
  process.exit(10);
}
`,
  );
  if (process.platform === "win32") {
    writeFileSync(join(bin, "pnpm.cmd"), `@"${process.execPath}" "${stub}" %*\r\n`);
  } else {
    writeFileSync(join(bin, "pnpm"), `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`, {
      mode: 0o755,
    });
  }
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const env = {
    ...process.env,
    [pathKey]: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env[pathKey] ?? ""}`,
    DOCS_SITE_URL: "https://docs.example.com",
    ALPHAPING_DEPLOY_TEST_CALLS: callsFile,
  };
  const args = ["scripts/deploy-workers.mjs", "--worker", "docs", "--env", "production"];
  const calls = () =>
    readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  for (const dryRun of [true, false]) {
    writeFileSync(callsFile, "");
    rmSync(join(app, "built-assets"), { force: true });
    const result = spawnSync(process.execPath, [...args, ...(dryRun ? ["--dry-run"] : [])], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      calls().map(({ args }) => args),
      [
        ["exec", "vite", "build"],
        [
          "exec",
          "wrangler",
          "deploy",
          "--config",
          "wrangler.docs.toml",
          "--env=production",
          ...(dryRun ? ["--dry-run"] : []),
        ],
      ],
    );
    assert.ok(calls().every((call) => call.cwd === app && call.origin === env.DOCS_SITE_URL));
  }
  writeFileSync(callsFile, "");
  const failure = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...env, ALPHAPING_DEPLOY_TEST_FAIL_BUILD: "1" },
    encoding: "utf8",
  });
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /docs build failed before deployment/);
  assert.deepEqual(
    calls().map(({ args }) => args),
    [["exec", "vite", "build"]],
  );
});
