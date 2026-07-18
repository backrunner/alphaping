import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const arguments_ = process.argv.slice(2);
const skipBuild = arguments_.includes("--skip-build");
if (arguments_.some((argument) => argument !== "--skip-build")) {
  throw new Error("Usage: check-agent-resources.mjs [--skip-build]");
}
if (!["darwin", "linux"].includes(process.platform)) {
  throw new Error(`Agent resource measurement is unsupported on ${process.platform}`);
}

const WARMUP_MS = 10_000;
const MEASUREMENT_MS = 30_000;
const SAMPLE_INTERVAL_MS = 1_000;
const RSS_LIMIT_MIB = 30;
const CPU_LIMIT_PERCENT = 0.5;

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw new Error(`${label} could not start`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status}`);
}

function cpuSeconds(value) {
  let remaining = value.trim();
  let days = 0;
  if (remaining.includes("-")) {
    const [dayValue, timeValue] = remaining.split("-", 2);
    days = Number(dayValue);
    remaining = timeValue;
  }
  const parts = remaining.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`ps returned invalid CPU time ${JSON.stringify(value)}`);
  }
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : parts.length === 2 ? [0, ...parts] : [0, 0, ...parts];
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

function processStats(pid) {
  const result = spawnSync("ps", ["-o", "rss=", "-o", "time=", "-p", String(pid)], {
    encoding: "utf8",
  });
  if (result.error) throw new Error("ps could not read Agent resources", { cause: result.error });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Agent exited during resource measurement (ps status ${result.status})`);
  }
  const match = result.stdout.trim().match(/^(\d+)\s+(.+)$/u);
  if (!match) throw new Error(`ps returned unexpected output ${JSON.stringify(result.stdout)}`);
  return { rssKib: Number(match[1]), cpuSeconds: cpuSeconds(match[2]) };
}

async function stopAgent(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}

if (process.platform === "darwin" && process.getuid?.() === 0) {
  throw new Error("Agent resource measurement refuses root access to the macOS System Keychain");
}
if (!skipBuild) {
  run(
    "node",
    ["scripts/run-cargo.mjs", "build", "-p", "alphaping-agent", "--release"],
    "release Agent build",
  );
}

const temporary = mkdtempSync(join(tmpdir(), "alphaping-agent-resources-"));
const configPath = join(temporary, "agent.toml");
const spoolPath = join(temporary, "spool.db");
const binary = join(root, "target", "release", "alphaping-agent");
writeFileSync(
  configPath,
  `endpoint = "https://127.0.0.1:1/v1/reports"
agent_id = "resource-benchmark-agent"
machine_pk = 1
workspace_pk = 1
key_epoch = 1
data_key_hex = "${"01".repeat(32)}"
nonce_prefix_hex = "${"02".repeat(4)}"
identity_private_key_hex = "${"03".repeat(32)}"
credential_storage = "restricted_file"
spool_path = ${JSON.stringify(spoolPath)}
sample_interval_seconds = 10
report_interval_seconds = 60
max_spool_bytes = 536870912
container_monitoring_enabled = false
auto_update = false
update_channel = "stable"
`,
  { mode: 0o600 },
);
chmodSync(configPath, 0o600);

let child = null;
let output = "";
try {
  child = spawn(binary, [configPath], {
    cwd: root,
    env: { ...process.env, RUST_LOG: "warn" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const recordOutput = (chunk) => {
    output = `${output}${chunk}`.slice(-8_192);
  };
  child.stdout.on("data", recordOutput);
  child.stderr.on("data", recordOutput);
  await delay(WARMUP_MS);
  if (child.exitCode !== null) {
    throw new Error(`Agent exited during warmup with status ${child.exitCode}\n${output}`);
  }

  const initial = processStats(child.pid);
  const rssSamples = [initial.rssKib];
  const startedAt = performance.now();
  while (performance.now() - startedAt < MEASUREMENT_MS) {
    await delay(SAMPLE_INTERVAL_MS);
    rssSamples.push(processStats(child.pid).rssKib);
  }
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  const final = processStats(child.pid);
  const maxRssMib = Math.max(...rssSamples, final.rssKib) / 1_024;
  const averageCpuPercent = ((final.cpuSeconds - initial.cpuSeconds) / elapsedSeconds) * 100;
  console.log(
    `Agent resources: max_rss=${maxRssMib.toFixed(2)}MiB average_cpu=${averageCpuPercent.toFixed(3)}% window=${elapsedSeconds.toFixed(1)}s samples=${rssSamples.length}`,
  );
  if (maxRssMib >= RSS_LIMIT_MIB) {
    throw new Error(`Agent max RSS ${maxRssMib.toFixed(2)} MiB exceeded ${RSS_LIMIT_MIB} MiB`);
  }
  if (averageCpuPercent >= CPU_LIMIT_PERCENT) {
    throw new Error(
      `Agent average CPU ${averageCpuPercent.toFixed(3)}% exceeded ${CPU_LIMIT_PERCENT}% of one core`,
    );
  }
} catch (cause) {
  if (output.trim()) console.error(`Agent output tail:\n${output.trim()}`);
  throw cause;
} finally {
  if (child) await stopAgent(child);
  rmSync(temporary, { force: true, recursive: true });
}
