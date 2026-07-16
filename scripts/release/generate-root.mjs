import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const privateDirectory = resolve(argument("--private-dir"));
const publicRoot = resolve(argument("--public-root"));
const repository = `${resolve(".")}${sep}`;
if (`${privateDirectory}${sep}`.startsWith(repository)) {
  throw new Error("release private keys must be generated outside the repository");
}

await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
const definitions = [
  ["root", 3],
  ["timestamp", 1],
  ["snapshot", 1],
  ["targets", 2],
];
const keys = {};
const roles = {};
for (const [role, count] of definitions) {
  const keyIds = [];
  for (let index = 0; index < count; index += 1) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    const rawPublicKey = publicDer.subarray(publicDer.length - 32);
    const keyId = createHash("sha256").update(rawPublicKey).digest("hex").slice(0, 32);
    keyIds.push(keyId);
    keys[keyId] = { scheme: "ed25519", public_key_hex: rawPublicKey.toString("hex") };
    await writeFile(
      resolve(privateDirectory, `${role}-${keyId}.pem`),
      privateKey.export({ format: "pem", type: "pkcs8" }),
      { mode: 0o600, flag: "wx" },
    );
  }
  roles[role] = { key_ids: keyIds, threshold: role === "root" || role === "targets" ? 2 : 1 };
}

const root = {
  spec_version: "1.0",
  version: 1,
  expires_at_ms: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
  keys,
  roles,
};
await mkdir(resolve(publicRoot, ".."), { recursive: true });
await writeFile(publicRoot, `${JSON.stringify(root, null, 2)}\n`, { flag: "wx" });
