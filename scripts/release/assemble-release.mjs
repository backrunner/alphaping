import { resolve } from "node:path";
import { assembleReleaseBundle } from "./lib/bundle.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const input = resolve(argument("--input"));
const output = resolve(argument("--output"));
const version = argument("--version");
const bundle = await assembleReleaseBundle(input, output, version);
console.log(`Assembled ${Object.keys(bundle.targets).length} verified Agent release targets`);
