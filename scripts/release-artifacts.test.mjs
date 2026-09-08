import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { packageReleaseArtifact, validatePackagedTarget } from "./release/lib/artifacts.mjs";
import { assembleReleaseBundle, validateReleaseBundle } from "./release/lib/bundle.mjs";
import {
  RELEASE_TARGETS,
  artifactName,
  canonicalJsonSha256,
  sha256File,
} from "./release/lib/common.mjs";
import { loadCargoMetadata } from "./release/lib/sbom.mjs";

const root = resolve(import.meta.dirname, "..");
const temporaryDirectories = [];
const version = "0.1.0";
const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
const sourceDateEpoch = 1_752_580_800;
const defaultRootHash = "ab".repeat(32);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function nativeTarget() {
  const platform = process.platform === "darwin" ? "macos" : process.platform;
  const arch =
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  return RELEASE_TARGETS.find((target) => target.platform === platform && target.arch === arch);
}

test(
  "packages a native Agent with a verifiable SPDX SBOM",
  { skip: process.platform === "win32" },
  async () => {
    const target = nativeTarget();
    assert.ok(target, "test host must be a supported Agent target");
    const directory = temporaryDirectory("alphaping-agent-package-");
    const binary = join(directory, "fake-agent");
    writeFileSync(
      binary,
      `#!/bin/sh\ncase "$1" in\n  --version) echo "alphaping-agent ${version}" ;;\n  release-info) printf 'version=${version}\\nplatform=${target.platform}\\narch=${target.arch}\\nupdate_root_sha256=${defaultRootHash}\\n' ;;\n  *) exit 2 ;;\nesac\n`,
    );
    chmodSync(binary, 0o755);
    const output = join(directory, "output");
    const manifest = await packageReleaseArtifact({
      root,
      binary,
      target: target.name,
      version,
      sourceCommit,
      sourceDateEpoch,
      output,
    });
    assert.equal(manifest.updateRootSha256, defaultRootHash);
    await validatePackagedTarget(output, target, version);
    const sbom = readFileSync(join(output, manifest.sbom.file), "utf8");
    assert.match(sbom, /"spdxVersion": "SPDX-2.3"/);
    assert.equal(sbom.includes(root), false);
  },
);

async function writeSyntheticPackages(directory, updateRootSha256) {
  for (const target of RELEASE_TARGETS) {
    const asset = artifactName(target);
    const bytes = Buffer.from(`synthetic ${target.name}\n`);
    writeFileSync(join(directory, asset), bytes);
    const assetHash = await sha256File(join(directory, asset));
    writeFileSync(join(directory, `${asset}.sha256`), `${assetHash}  ${asset}\n`);
    const sbomName = `${asset}.spdx.json`;
    writeFileSync(
      join(directory, sbomName),
      `${JSON.stringify({
        spdxVersion: "SPDX-2.3",
        dataLicense: "CC0-1.0",
        packages: [{ name: "alphaping-agent", versionInfo: version }],
      })}\n`,
    );
    const manifest = {
      formatVersion: 1,
      target: target.name,
      rustTarget: target.rustTarget,
      platform: target.platform,
      arch: target.arch,
      version,
      sourceCommit,
      sourceDateEpoch,
      updateRootSha256,
      asset: { file: asset, bytes: bytes.length, sha256: assetHash },
      sbom: { file: sbomName, sha256: await sha256File(join(directory, sbomName)) },
    };
    writeFileSync(
      join(directory, `${target.name}.artifact.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
}

async function syntheticBundle(updateRootSha256 = defaultRootHash, directory = null) {
  const parent = directory ?? temporaryDirectory("alphaping-agent-bundle-");
  const packages = join(parent, "packages");
  const bundle = join(parent, "bundle");
  mkdirSync(packages);
  await writeSyntheticPackages(packages, updateRootSha256);
  await assembleReleaseBundle(packages, bundle, version);
  return { parent, bundle };
}

test("assembles and verifies all six release targets", async () => {
  const { bundle } = await syntheticBundle();
  const manifest = await validateReleaseBundle(bundle, version);
  assert.equal(Object.keys(manifest.targets).length, 6);

  const asset = join(bundle, artifactName(RELEASE_TARGETS[0]));
  const bytes = readFileSync(asset);
  bytes[0] ^= 1;
  writeFileSync(asset, bytes);
  await assert.rejects(validateReleaseBundle(bundle, version), /hash mismatch/);
});

test("builds threshold-signed metadata only from the embedded update root", async () => {
  const directory = temporaryDirectory("alphaping-agent-signing-");
  const keys = join(directory, "offline-keys");
  const publicRoot = join(directory, "root.json");
  const signed = join(directory, "signed");
  let result = spawnSync(
    "node",
    ["scripts/release/generate-root.mjs", "--private-dir", keys, "--public-root", publicRoot],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const updateRootSha256 = canonicalJsonSha256(JSON.parse(readFileSync(publicRoot, "utf8")));
  const { bundle } = await syntheticBundle(updateRootSha256, directory);
  result = spawnSync(
    "node",
    [
      "scripts/release/build-metadata.mjs",
      "--root",
      publicRoot,
      "--private-dir",
      keys,
      "--artifacts",
      bundle,
      "--output",
      signed,
      "--version",
      version,
      "--metadata-version",
      "1",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const targets = JSON.parse(readFileSync(join(signed, "alphaping-tuf-targets.json"), "utf8"));
  assert.equal(targets.signatures.length, 2);
  assert.equal(Object.keys(targets.signed.targets).length, 6);

  const otherKeys = join(directory, "other-keys");
  const otherRoot = join(directory, "other-root.json");
  result = spawnSync(
    "node",
    ["scripts/release/generate-root.mjs", "--private-dir", otherKeys, "--public-root", otherRoot],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync(
    "node",
    [
      "scripts/release/build-metadata.mjs",
      "--root",
      otherRoot,
      "--private-dir",
      otherKeys,
      "--artifacts",
      bundle,
      "--output",
      join(directory, "wrong-root-signed"),
      "--version",
      version,
      "--metadata-version",
      "1",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /different update root/);
});

test("Cargo metadata used by SBOM generation is target-filtered and locked", () => {
  const target = nativeTarget() ?? RELEASE_TARGETS[0];
  const metadata = loadCargoMetadata(root, target.rustTarget);
  assert.ok(metadata.resolve);
  assert.ok(metadata.packages.some((item) => item.name === "alphaping-agent"));
});
