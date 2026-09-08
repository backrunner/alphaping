import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
