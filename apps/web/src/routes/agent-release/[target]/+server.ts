import { error } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

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

export const GET: RequestHandler = ({ params, platform }) => {
  if (!platform || !supportedTargets.has(params.target)) throw error(404, "Release not found");
  let manifest: Record<string, ReleaseTarget>;
  try {
    if (platform.env.AGENT_RELEASE_MANIFEST_JSON.length > 16 * 1024) throw new Error();
    manifest = JSON.parse(platform.env.AGENT_RELEASE_MANIFEST_JSON) as Record<
      string,
      ReleaseTarget
    >;
  } catch {
    throw error(503, "Agent release manifest is unavailable");
  }
  const target = manifest[params.target];
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
  const suffix = params.target.startsWith("windows-") ? ".exe" : "";
  const asset = `alphaping-agent-${params.target}${suffix}`;
  const url = `https://github.com/alkinum/alphaping/releases/download/v${target.version}/${asset}`;
  return new Response(`${target.version} ${target.length} ${target.sha256} ${url}\n`, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
};
