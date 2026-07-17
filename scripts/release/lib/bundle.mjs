import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePackagedTarget } from "./artifacts.mjs";
import {
  GIT_COMMIT_PATTERN,
  RELEASE_TARGETS,
  SHA256_PATTERN,
  artifactName,
  sha256File,
  validateVersion,
} from "./common.mjs";

export async function assembleReleaseBundle(input, output, version) {
  validateVersion(version);
  await mkdir(output, { recursive: true });
  const manifests = [];
  for (const target of RELEASE_TARGETS) {
    manifests.push(await validatePackagedTarget(input, target, version));
  }
  const first = manifests[0];
  for (const manifest of manifests) {
    if (
      manifest.sourceCommit !== first.sourceCommit ||
      manifest.sourceDateEpoch !== first.sourceDateEpoch ||
      manifest.updateRootSha256 !== first.updateRootSha256
    ) {
      throw new Error("release artifacts were not built from one source and update root");
    }
    for (const file of [
      manifest.asset.file,
      `${manifest.asset.file}.sha256`,
      manifest.sbom.file,
      `${manifest.target}.artifact.json`,
    ]) {
      await copyFile(resolve(input, file), resolve(output, file), constants.COPYFILE_EXCL);
    }
  }

  const bundle = {
    formatVersion: 1,
    version,
    sourceCommit: first.sourceCommit,
    sourceDateEpoch: first.sourceDateEpoch,
    updateRootSha256: first.updateRootSha256,
    targets: Object.fromEntries(manifests.map((manifest) => [manifest.target, manifest])),
  };
  const bundleName = "agent-release-bundle.json";
  await writeFile(resolve(output, bundleName), `${JSON.stringify(bundle, null, 2)}\n`, {
    flag: "wx",
  });
  const checksumFiles = [
    bundleName,
    ...manifests.flatMap((manifest) => [
      manifest.asset.file,
      manifest.sbom.file,
      `${manifest.target}.artifact.json`,
    ]),
  ].sort();
  const checksums = [];
  for (const file of checksumFiles) {
    checksums.push(`${await sha256File(resolve(output, file))}  ${file}`);
  }
  await writeFile(resolve(output, "SHA256SUMS"), `${checksums.join("\n")}\n`, { flag: "wx" });
  return bundle;
}

export async function validateReleaseBundle(directory, version) {
  const bundle = JSON.parse(
    await readFile(resolve(directory, "agent-release-bundle.json"), "utf8"),
  );
  if (
    bundle?.formatVersion !== 1 ||
    bundle.version !== version ||
    !GIT_COMMIT_PATTERN.test(bundle.sourceCommit ?? "") ||
    !Number.isSafeInteger(bundle.sourceDateEpoch) ||
    !SHA256_PATTERN.test(bundle.updateRootSha256 ?? "") ||
    Object.keys(bundle.targets ?? {}).length !== RELEASE_TARGETS.length
  ) {
    throw new Error("invalid Agent release bundle manifest");
  }
  for (const target of RELEASE_TARGETS) {
    const manifest = await validatePackagedTarget(directory, target, version);
    if (JSON.stringify(manifest) !== JSON.stringify(bundle.targets?.[target.name])) {
      throw new Error(`bundle manifest mismatch for ${target.name}`);
    }
  }
  const expectedFiles = [
    "agent-release-bundle.json",
    ...RELEASE_TARGETS.flatMap((target) => [
      artifactName(target),
      `${artifactName(target)}.spdx.json`,
      `${target.name}.artifact.json`,
    ]),
  ].sort();
  const lines = (await readFile(resolve(directory, "SHA256SUMS"), "utf8")).trim().split("\n");
  if (lines.length !== expectedFiles.length) {
    throw new Error("release bundle checksum file list is incomplete");
  }
  const seen = new Set();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
    if (
      !match ||
      seen.has(match[2]) ||
      !expectedFiles.includes(match[2]) ||
      (await sha256File(resolve(directory, match[2]))) !== match[1]
    ) {
      throw new Error("release bundle checksum verification failed");
    }
    seen.add(match[2]);
  }
  return bundle;
}
