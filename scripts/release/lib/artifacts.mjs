import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GIT_COMMIT_PATTERN,
  MAX_ARTIFACT_BYTES,
  SHA256_PATTERN,
  artifactName,
  releaseTarget,
  sha256File,
  validateVersion,
} from "./common.mjs";
import { createSpdxDocument, loadCargoMetadata } from "./sbom.mjs";

function runBinary(command, argument, label) {
  const result = spawnSync(command, [argument], { encoding: "utf8", env: process.env });
  if (result.error) throw new Error(`${label} could not start`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr?.trim() ?? ""}`);
  return result.stdout.trim();
}

function parseReleaseInfo(output) {
  const fields = new Map();
  const lines = output.split(/\r?\n/);
  if (lines.length !== 4) throw new Error("Agent release-info output is invalid");
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Agent release-info output is invalid");
    const key = line.slice(0, separator);
    if (fields.has(key)) throw new Error("Agent release-info output contains duplicate fields");
    fields.set(key, line.slice(separator + 1));
  }
  return fields;
}

export function verifyReleaseBinary(binary, target, version) {
  const reportedVersion = runBinary(binary, "--version", "Agent version check");
  if (reportedVersion !== `alphaping-agent ${version}`) {
    throw new Error("Agent binary version does not match the release version");
  }
  const information = parseReleaseInfo(
    runBinary(binary, "release-info", "Agent release-info check"),
  );
  if (
    information.size !== 4 ||
    information.get("version") !== version ||
    information.get("platform") !== target.platform ||
    information.get("arch") !== target.arch ||
    !SHA256_PATTERN.test(information.get("update_root_sha256") ?? "")
  ) {
    throw new Error("Agent release-info does not match the release target or trusted root");
  }
  return information.get("update_root_sha256");
}

export async function packageReleaseArtifact(options) {
  const target = releaseTarget(options.target);
  const version = validateVersion(options.version);
  if (!GIT_COMMIT_PATTERN.test(options.sourceCommit)) {
    throw new Error("source commit must be a full Git SHA");
  }
  if (!Number.isSafeInteger(options.sourceDateEpoch) || options.sourceDateEpoch <= 0) {
    throw new Error("source date epoch must be a positive integer");
  }
  const binary = resolve(options.binary);
  const details = await stat(binary);
  if (!details.isFile() || details.size < 1 || details.size > MAX_ARTIFACT_BYTES) {
    throw new Error("Agent binary has an invalid size");
  }
  const rootHash = verifyReleaseBinary(binary, target, version);
  const output = resolve(options.output);
  await mkdir(output, { recursive: true });
  const asset = artifactName(target);
  const assetPath = resolve(output, asset);
  await copyFile(binary, assetPath, constants.COPYFILE_EXCL);
  if (target.platform !== "windows") await chmod(assetPath, 0o755);
  const assetHash = await sha256File(assetPath);
  const metadata = loadCargoMetadata(options.root, target.rustTarget);
  const sbomName = `${asset}.spdx.json`;
  const sbomPath = resolve(output, sbomName);
  const sbom = createSpdxDocument(metadata, {
    assetName: asset,
    version,
    sourceDateEpoch: options.sourceDateEpoch,
  });
  await writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, { flag: "wx" });
  const sbomHash = await sha256File(sbomPath);
  await writeFile(resolve(output, `${asset}.sha256`), `${assetHash}  ${asset}\n`, { flag: "wx" });
  const manifest = {
    formatVersion: 1,
    target: target.name,
    rustTarget: target.rustTarget,
    platform: target.platform,
    arch: target.arch,
    version,
    sourceCommit: options.sourceCommit,
    sourceDateEpoch: options.sourceDateEpoch,
    updateRootSha256: rootHash,
    asset: { file: asset, bytes: details.size, sha256: assetHash },
    sbom: { file: sbomName, sha256: sbomHash },
  };
  await writeFile(
    resolve(output, `${target.name}.artifact.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return manifest;
}

function assertManifest(manifest, target, version) {
  if (
    manifest?.formatVersion !== 1 ||
    manifest.target !== target.name ||
    manifest.rustTarget !== target.rustTarget ||
    manifest.platform !== target.platform ||
    manifest.arch !== target.arch ||
    manifest.version !== version ||
    !GIT_COMMIT_PATTERN.test(manifest.sourceCommit ?? "") ||
    !Number.isSafeInteger(manifest.sourceDateEpoch) ||
    manifest.sourceDateEpoch <= 0 ||
    !SHA256_PATTERN.test(manifest.updateRootSha256 ?? "") ||
    manifest.asset?.file !== artifactName(target) ||
    !Number.isSafeInteger(manifest.asset?.bytes) ||
    manifest.asset.bytes <= 0 ||
    manifest.asset.bytes > MAX_ARTIFACT_BYTES ||
    !SHA256_PATTERN.test(manifest.asset?.sha256 ?? "") ||
    manifest.sbom?.file !== `${artifactName(target)}.spdx.json` ||
    !SHA256_PATTERN.test(manifest.sbom?.sha256 ?? "")
  ) {
    throw new Error(`invalid artifact manifest for ${target.name}`);
  }
}

export async function validatePackagedTarget(directory, target, version) {
  const manifestPath = resolve(directory, `${target.name}.artifact.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertManifest(manifest, target, version);
  const assetPath = resolve(directory, manifest.asset.file);
  const assetDetails = await stat(assetPath);
  if (
    assetDetails.size !== manifest.asset.bytes ||
    (await sha256File(assetPath)) !== manifest.asset.sha256
  ) {
    throw new Error(`artifact hash mismatch for ${target.name}`);
  }
  const checksum = await readFile(resolve(directory, `${manifest.asset.file}.sha256`), "utf8");
  if (checksum !== `${manifest.asset.sha256}  ${manifest.asset.file}\n`) {
    throw new Error(`checksum sidecar mismatch for ${target.name}`);
  }
  const sbomPath = resolve(directory, manifest.sbom.file);
  if ((await sha256File(sbomPath)) !== manifest.sbom.sha256) {
    throw new Error(`SBOM hash mismatch for ${target.name}`);
  }
  const sbom = JSON.parse(await readFile(sbomPath, "utf8"));
  if (
    sbom.spdxVersion !== "SPDX-2.3" ||
    sbom.dataLicense !== "CC0-1.0" ||
    !Array.isArray(sbom.packages) ||
    !sbom.packages.some((item) => item.name === "alphaping-agent" && item.versionInfo === version)
  ) {
    throw new Error(`invalid SPDX SBOM for ${target.name}`);
  }
  return manifest;
}
