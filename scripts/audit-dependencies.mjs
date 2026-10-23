import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const audit = spawnSync(pnpm, ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
if (audit.error || audit.signal || ![0, 1].includes(audit.status)) {
  throw new Error("Dependency audit could not complete", { cause: audit.error });
}
const report = JSON.parse(audit.stdout);
if (!report.metadata?.vulnerabilities || report.error) {
  throw new Error("Dependency audit returned an incomplete report");
}

const advisories = Object.values(report.advisories ?? {});
const vulnerabilityCounts = Object.values(report.metadata.vulnerabilities);
if (
  vulnerabilityCounts.length === 0 ||
  vulnerabilityCounts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
  ((audit.status === 1 || vulnerabilityCounts.some((count) => count > 0)) &&
    advisories.length === 0)
) {
  throw new Error("Dependency audit omitted vulnerability details");
}
const patched = advisories.filter(
  (advisory) =>
    advisory.github_advisory_id === "GHSA-vfj7-8cjw-p6xm" &&
    advisory.module_name === "braces" &&
    advisory.findings?.length > 0 &&
    advisory.findings.every(
      (finding) =>
        finding.version === "3.0.3" &&
        finding.paths?.length > 0 &&
        finding.paths.every((path) =>
          /^apps__docs>svedocs(?:-cli>svedocs)?>fast-glob>micromatch>braces$/.test(path),
        ),
    ),
);
const unresolved = advisories.filter((advisory) => !patched.includes(advisory));
for (const advisory of unresolved) {
  console.error(`${advisory.severity}: ${advisory.module_name}: ${advisory.url}`);
}
if (unresolved.length > 0) process.exit(1);

// Do not silently ignore the advisory. Verify the installed dependency's actual
// behavior before accepting the exact build-only finding covered by our patch.
if (patched.length > 0) {
  const regression = spawnSync(
    process.execPath,
    ["--test", "scripts/dependency-patches.test.mjs"],
    {
      stdio: "inherit",
    },
  );
  if (regression.status !== 0) process.exit(regression.status ?? 1);
  console.log("GHSA-vfj7-8cjw-p6xm: installed braces nesting patch verified (upstream unpatched)");
}
console.log(`Dependency audit: ${unresolved.length} unresolved, ${patched.length} locally patched`);
