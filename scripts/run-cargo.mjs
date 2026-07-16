import { dirname, delimiter } from "node:path";
import { spawnSync } from "node:child_process";

let cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
let environment = process.env;
const rustupCargo = spawnSync("rustup", ["which", "cargo"], {
  encoding: "utf8",
  env: process.env,
});

if (rustupCargo.status === 0 && rustupCargo.stdout.trim()) {
  cargo = rustupCargo.stdout.trim();
  environment = {
    ...process.env,
    PATH: `${dirname(cargo)}${delimiter}${process.env.PATH ?? ""}`,
  };
}

const result = spawnSync(cargo, process.argv.slice(2), {
  env: environment,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
