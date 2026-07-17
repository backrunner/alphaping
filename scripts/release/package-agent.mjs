import { resolve } from "node:path";
import { packageReleaseArtifact } from "./lib/artifacts.mjs";

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("release package flags require values");
    values[flag.slice(2)] = value;
  }
  for (const required of [
    "binary",
    "target",
    "version",
    "source-commit",
    "source-date-epoch",
    "output",
  ]) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return values;
}

const values = argumentsFrom(process.argv.slice(2));
const sourceDateEpoch = Number(values["source-date-epoch"]);
const manifest = await packageReleaseArtifact({
  root: resolve(import.meta.dirname, "../.."),
  binary: values.binary,
  target: values.target,
  version: values.version,
  sourceCommit: values["source-commit"],
  sourceDateEpoch,
  output: values.output,
});
console.log(`Packaged ${manifest.asset.file} with SPDX SBOM and SHA-256`);
