import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export function loadCargoMetadata(root, rustTarget) {
  const result = spawnSync(
    "cargo",
    ["metadata", "--locked", "--format-version", "1", "--filter-platform", rustTarget],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error) throw new Error("Cargo metadata could not start", { cause: result.error });
  if (result.status !== 0) throw new Error(`Cargo metadata failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

function dependencyClosure(metadata) {
  const agent = metadata.packages.find((candidate) => candidate.name === "alphaping-agent");
  if (!agent || !metadata.resolve)
    throw new Error("Cargo metadata omitted the Agent dependency graph");
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const included = new Set();
  const queue = [agent.id];
  while (queue.length > 0) {
    const packageId = queue.shift();
    if (!packageId || included.has(packageId)) continue;
    included.add(packageId);
    const node = nodes.get(packageId);
    for (const dependency of node?.deps ?? []) {
      const nonDevelopment = dependency.dep_kinds.some((kind) => kind.kind !== "dev");
      if (nonDevelopment) queue.push(dependency.pkg);
    }
  }
  return { agent, included, nodes };
}

function spdxId(value) {
  return `SPDXRef-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function createSpdxDocument(metadata, input) {
  const { agent, included, nodes } = dependencyClosure(metadata);
  const packages = metadata.packages
    .filter((item) => included.has(item.id))
    .sort((left, right) =>
      `${left.name}@${left.version}:${left.source ?? "workspace"}`.localeCompare(
        `${right.name}@${right.version}:${right.source ?? "workspace"}`,
      ),
    );
  const identifiers = new Map(
    packages.map((item) => [
      item.id,
      spdxId(`${item.name}@${item.version}:${item.source ?? "workspace"}`),
    ]),
  );
  const relationshipKeys = new Set([`SPDXRef-DOCUMENT\0DESCRIBES\0${identifiers.get(agent.id)}`]);
  for (const item of packages) {
    const source = identifiers.get(item.id);
    for (const dependency of nodes.get(item.id)?.deps ?? []) {
      const destination = identifiers.get(dependency.pkg);
      const nonDevelopment = dependency.dep_kinds.some((kind) => kind.kind !== "dev");
      if (source && destination && nonDevelopment) {
        relationshipKeys.add(`${source}\0DEPENDS_ON\0${destination}`);
      }
    }
  }
  const relationships = [...relationshipKeys].sort().map((relationship) => {
    const [spdxElementId, relationshipType, relatedSpdxElement] = relationship.split("\0");
    return { spdxElementId, relationshipType, relatedSpdxElement };
  });

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${input.assetName}-${input.version}`,
    documentNamespace: `https://github.com/BackRunner/alphaping/releases/download/v${input.version}/${input.assetName}.spdx.json`,
    creationInfo: {
      created: new Date(input.sourceDateEpoch * 1000).toISOString(),
      creators: ["Organization: AlphaPing contributors", "Tool: alphaping-release-tool/1"],
    },
    documentDescribes: [identifiers.get(agent.id)],
    packages: packages.map((item) => ({
      name: item.name,
      SPDXID: identifiers.get(item.id),
      versionInfo: item.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: item.license ?? "NOASSERTION",
      copyrightText: "NOASSERTION",
      primaryPackagePurpose: item.id === agent.id ? "APPLICATION" : "LIBRARY",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:cargo/${encodeURIComponent(item.name)}@${item.version}`,
        },
      ],
    })),
    relationships,
  };
}
