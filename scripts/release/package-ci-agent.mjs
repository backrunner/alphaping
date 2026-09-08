import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { artifactName, MAX_ARTIFACT_BYTES, releaseTarget, sha256File } from "./lib/common.mjs";
import { createSpdxDocument, loadCargoMetadata } from "./lib/sbom.mjs";

const { values } = parseArgs({
  options: { binary: { type: "string" }, target: { type: "string" }, output: { type: "string" } },
});
assert.ok(
  values.binary && values.target && values.output,
  "binary, target and output are required",
);
const root = resolve(import.meta.dirname, "../..");
const target = releaseTarget(values.target);
const platform = { darwin: "macos", win32: "windows", linux: "linux" }[process.platform];
assert.equal(target.platform, platform);
assert.equal(
  target.arch,
  process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch,
);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

const metadata = loadCargoMetadata(root, target.rustTarget);
const version = metadata.packages.find((item) => item.name === "alphaping-agent")?.version;
assert.ok(version);
const sourceCommit = run("git", ["rev-parse", "HEAD"]);
const sourceDateEpoch = Number(run("git", ["show", "-s", "--format=%ct", "HEAD"]));
const binary = resolve(values.binary);
const details = await stat(binary);
assert.ok(details.isFile() && details.size > 0 && details.size <= MAX_ARTIFACT_BYTES);
assert.equal(run(binary, ["--version"]), `alphaping-agent ${version}`);

const output = resolve(values.output);
await mkdir(output, { recursive: false });
const asset = artifactName(target);
await copyFile(binary, resolve(output, asset));
const sha256 = await sha256File(resolve(output, asset));
await writeFile(resolve(output, "SHA256SUMS"), `${sha256}  ${asset}\n`);
await writeFile(
  resolve(output, "build.json"),
  `${JSON.stringify(
    {
      kind: "ci",
      version,
      target: target.name,
      sourceCommit,
      sourceDateEpoch,
      bytes: details.size,
      sha256,
      productionRelease: false,
    },
    null,
    2,
  )}\n`,
);
const sbom = createSpdxDocument(metadata, { assetName: asset, version, sourceDateEpoch });
sbom.documentNamespace = `https://github.com/BackRunner/alphaping/commit/${sourceCommit}/${target.name}.spdx.json`;
await writeFile(resolve(output, `${asset}.spdx.json`), `${JSON.stringify(sbom, null, 2)}\n`);
for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  await copyFile(resolve(root, file), resolve(output, file));
}
await writeFile(
  resolve(output, "README.txt"),
  "AlphaPing CI build for evaluation. No production update root is embedded.\n" +
    "Automatic updates are disabled. Use signed GitHub Releases for production installation.\n" +
    `Source: https://github.com/BackRunner/alphaping/commit/${sourceCommit}\n`,
);
console.log(`Packaged CI build ${asset} (${sourceCommit})`);
