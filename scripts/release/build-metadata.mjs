import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function envelope(role, signed, root, privateDirectory) {
  const roleDefinition = root.roles[role];
  if (!roleDefinition || roleDefinition.threshold < 1) throw new Error(`root omitted ${role}`);
  const payload = Buffer.from(canonical(signed));
  const signatures = [];
  for (const keyId of roleDefinition.key_ids) {
    const matching = [
      resolve(privateDirectory, `${role}-${keyId}.pem`),
      resolve(privateDirectory, `${keyId}.pem`),
    ];
    let pem;
    for (const path of matching) {
      try {
        pem = await readFile(path);
        break;
      } catch {}
    }
    if (!pem) continue;
    signatures.push({
      key_id: keyId,
      signature_hex: sign(null, payload, createPrivateKey(pem)).toString("hex"),
    });
  }
  if (signatures.length < roleDefinition.threshold) {
    throw new Error(`${role} signature threshold was not met`);
  }
  return Buffer.from(canonical({ signed, signatures }));
}

function metadataFile(version, bytes) {
  return {
    version,
    length: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const root = JSON.parse(await readFile(resolve(argument("--root")), "utf8"));
const privateDirectory = resolve(argument("--private-dir"));
const artifactDirectory = resolve(argument("--artifacts"));
const outputDirectory = resolve(argument("--output"));
const version = argument("--version");
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("--version must be an exact semantic version");
}
const metadataVersion = Number(argument("--metadata-version"));
if (!Number.isSafeInteger(metadataVersion) || metadataVersion < 1) {
  throw new Error("--metadata-version must be a positive integer");
}
const rolloutPercent = Number(process.env.ALPHAPING_ROLLOUT_PERCENT ?? "100");
if (!Number.isInteger(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
  throw new Error("ALPHAPING_ROLLOUT_PERCENT must be between 0 and 100");
}
const targetNames = [
  ["linux-x86_64", "linux", "x86_64", ""],
  ["linux-aarch64", "linux", "aarch64", ""],
  ["macos-x86_64", "macos", "x86_64", ""],
  ["macos-aarch64", "macos", "aarch64", ""],
  ["windows-x86_64", "windows", "x86_64", ".exe"],
  ["windows-aarch64", "windows", "aarch64", ".exe"],
];
const targets = {};
for (const [target, platform, arch, suffix] of targetNames) {
  const name = `alphaping-agent-${target}${suffix}`;
  const path = resolve(artifactDirectory, name);
  const details = await stat(path);
  if (!details.isFile() || details.size < 1 || details.size > 64 * 1024 * 1024) {
    throw new Error(`${name} has an invalid size`);
  }
  targets[basename(path)] = {
    version,
    platform,
    arch,
    channel: "stable",
    length: details.size,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    rollout_percent: rolloutPercent,
  };
}

const now = Date.now();
const targetsBytes = await envelope(
  "targets",
  {
    type: "targets",
    spec_version: "1.0",
    version: metadataVersion,
    expires_at_ms: now + 30 * 24 * 60 * 60 * 1000,
    targets,
  },
  root,
  privateDirectory,
);
const snapshotBytes = await envelope(
  "snapshot",
  {
    type: "snapshot",
    spec_version: "1.0",
    version: metadataVersion,
    expires_at_ms: now + 7 * 24 * 60 * 60 * 1000,
    targets: metadataFile(metadataVersion, targetsBytes),
  },
  root,
  privateDirectory,
);
const timestampBytes = await envelope(
  "timestamp",
  {
    type: "timestamp",
    spec_version: "1.0",
    version: metadataVersion,
    expires_at_ms: now + 24 * 60 * 60 * 1000,
    snapshot: metadataFile(metadataVersion, snapshotBytes),
  },
  root,
  privateDirectory,
);

await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "alphaping-tuf-targets.json"), targetsBytes, {
  flag: "wx",
});
await writeFile(resolve(outputDirectory, "alphaping-tuf-snapshot.json"), snapshotBytes, {
  flag: "wx",
});
await writeFile(resolve(outputDirectory, "alphaping-tuf-timestamp.json"), timestampBytes, {
  flag: "wx",
});
await writeFile(
  resolve(outputDirectory, "agent-release-manifest.json"),
  `${JSON.stringify(
    Object.fromEntries(
      targetNames.map(([target, _platform, _arch, suffix]) => {
        const description = targets[`alphaping-agent-${target}${suffix}`];
        return [target, { version, length: description.length, sha256: description.sha256 }];
      }),
    ),
  )}\n`,
  { flag: "wx" },
);
