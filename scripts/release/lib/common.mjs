import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const RELEASE_TARGETS = Object.freeze([
  Object.freeze({
    name: "linux-x86_64",
    platform: "linux",
    arch: "x86_64",
    rustTarget: "x86_64-unknown-linux-gnu",
    suffix: "",
  }),
  Object.freeze({
    name: "linux-aarch64",
    platform: "linux",
    arch: "aarch64",
    rustTarget: "aarch64-unknown-linux-gnu",
    suffix: "",
  }),
  Object.freeze({
    name: "macos-x86_64",
    platform: "macos",
    arch: "x86_64",
    rustTarget: "x86_64-apple-darwin",
    suffix: "",
  }),
  Object.freeze({
    name: "macos-aarch64",
    platform: "macos",
    arch: "aarch64",
    rustTarget: "aarch64-apple-darwin",
    suffix: "",
  }),
  Object.freeze({
    name: "windows-x86_64",
    platform: "windows",
    arch: "x86_64",
    rustTarget: "x86_64-pc-windows-msvc",
    suffix: ".exe",
  }),
  Object.freeze({
    name: "windows-aarch64",
    platform: "windows",
    arch: "aarch64",
    rustTarget: "aarch64-pc-windows-msvc",
    suffix: ".exe",
  }),
]);

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SEMANTIC_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function releaseTarget(name) {
  const target = RELEASE_TARGETS.find((candidate) => candidate.name === name);
  if (!target) throw new Error(`unsupported release target: ${name}`);
  return target;
}

export function validateVersion(version) {
  if (!SEMANTIC_VERSION.test(version)) throw new Error("version must be an exact semantic version");
  return version;
}

export function artifactName(target) {
  return `alphaping-agent-${target.name}${target.suffix}`;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
