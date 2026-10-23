import { error } from "@sveltejs/kit";

const supportedTargets = new Set([
  "linux-x86_64",
  "linux-aarch64",
  "macos-x86_64",
  "macos-aarch64",
  "windows-x86_64",
  "windows-aarch64",
]);
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

interface ReleaseTarget {
  version: string;
  length: number;
  sha256: string;
}

export function agentReleaseResponse(targetName: string, manifestJson: string): Response {
  if (!supportedTargets.has(targetName)) throw error(404, "Release not found");
  let manifest: Record<string, ReleaseTarget>;
  try {
    if (manifestJson.length > 16 * 1024) throw new Error();
    const parsed = JSON.parse(manifestJson) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    manifest = parsed as Record<string, ReleaseTarget>;
  } catch {
    throw error(503, "Agent release manifest is unavailable");
  }
  const target = manifest[targetName];
  if (
    !target ||
    !versionPattern.test(target.version) ||
    !Number.isSafeInteger(target.length) ||
    target.length < 1 ||
    target.length > 64 * 1024 * 1024 ||
    !sha256Pattern.test(target.sha256) ||
    /^0+$/.test(target.sha256)
  ) {
    throw error(503, "Agent release is not configured");
  }
  const suffix = targetName.startsWith("windows-") ? ".exe" : "";
  const asset = `alphaping-agent-${targetName}${suffix}`;
  const url = `https://github.com/BackRunner/alphaping/releases/download/v${target.version}/${asset}`;
  return new Response(`${target.version} ${target.length} ${target.sha256} ${url}\n`, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
