import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const arguments_ = process.argv.slice(2);
const skipBuild = arguments_.includes("--skip-build");
if (arguments_.some((argument) => argument !== "--skip-build")) {
  throw new Error("Usage: test-ingest-e2e.mjs [--skip-build]");
}

function run(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: options.quiet ? "utf8" : undefined,
    env: { ...process.env, CI: "true" },
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw new Error(`${label} could not start`, { cause: result.error });
  if (result.status !== 0) {
    throw new Error(`${label} failed${options.quiet ? `: ${result.stderr?.trim() ?? ""}` : ""}`);
  }
  return result;
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("cannot allocate ingest E2E port");
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitForServer(origin, processOutput) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (processOutput.exited) {
      throw new Error(`Ingest Worker exited before startup\n${processOutput.text}`);
    }
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Ingest Worker did not start within 30 seconds\n${processOutput.text}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}

function jsonPayload(output) {
  const trimmed = output.trim();
  const jsonStart = trimmed.lastIndexOf("\n[");
  return JSON.parse(jsonStart === -1 ? trimmed : trimmed.slice(jsonStart + 1));
}

const temporary = mkdtempSync(join(tmpdir(), "alphaping-ingest-e2e-"));
const persistTo = join(temporary, "state");
const pepperHex = "11".repeat(32);
const wrappingKeyHex = "22".repeat(32);
function enrollmentToken(fill) {
  const value = Buffer.alloc(32, fill).toString("base64url");
  const digest = createHmac("sha256", Buffer.from(pepperHex, "hex")).update(value).digest("hex");
  return { value, digest };
}
const token = enrollmentToken(0x2a);
const expiredToken = enrollmentToken(0x2b);
const revokedToken = enrollmentToken(0x2c);
const userId = "018f5f7e-7d28-7e12-a521-000000000001";
const workspaceId = "018f5f7e-7d28-7e12-a521-000000000002";
const machineId = "018f5f7e-7d28-7e12-a521-000000000003";
const enrollmentId = "018f5f7e-7d28-7e12-a521-000000000004";
const expiredEnrollmentId = "018f5f7e-7d28-7e12-a521-000000000005";
const revokedEnrollmentId = "018f5f7e-7d28-7e12-a521-000000000006";
let child = null;

try {
  if (!skipBuild) {
    run(pnpm, ["--filter", "@alphaping/worker-ingest", "build"], "Ingest Worker build");
  }
  for (const binding of ["CONTROL_DB", "TELEMETRY_DB"]) {
    run(
      pnpm,
      [
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        binding,
        "--local",
        "--config",
        resolve(root, "packages/db/wrangler.db.template.toml"),
        "--persist-to",
        persistTo,
      ],
      `${binding} migrations`,
      { quiet: true },
    );
  }

  const config = join(temporary, "wrangler.ingest.e2e.jsonc");
  const envFile = join(temporary, ".dev.vars");
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        name: "alphaping-ingest-e2e",
        main: resolve(root, "workers/ingest/build/worker/shim.mjs"),
        compatibility_date: "2026-07-17",
        vars: { LIVE_ORIGIN: "wss://live.example.test" },
        d1_databases: [
          {
            binding: "CONTROL_DB",
            database_name: "alphaping-control-ingest-e2e",
            database_id: "00000000-0000-0000-0000-000000000000",
          },
          {
            binding: "TELEMETRY_DB",
            database_name: "alphaping-telemetry-ingest-e2e",
            database_id: "00000000-0000-0000-0000-000000000000",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    envFile,
    [
      `KEY_WRAPPING_SECRET=${wrappingKeyHex}`,
      `ENROLLMENT_TOKEN_PEPPER=${pepperHex}`,
      `CHECK_SECRET_WRAPPING_KEY=${"33".repeat(32)}`,
      "LIVE_TICKET_SECRET=e2e-live-ticket-secret-that-is-at-least-32-bytes-long",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const now = Date.now();
  const seedSql = `
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${userId}', 'Ingest E2E', 'ingest@example.test', 1, ${now}, ${now});
    INSERT INTO workspaces (id, telemetry_pk, slug, name, created_at, updated_at)
      VALUES ('${workspaceId}', 1, 'ingest-e2e', 'Ingest E2E', ${now}, ${now});
    INSERT INTO machines
      (id, telemetry_pk, workspace_id, name, sampling_interval_seconds,
       report_interval_seconds, offline_after_seconds, container_monitoring_enabled,
       desired_config_revision, created_at, updated_at)
      VALUES ('${machineId}', 1, '${workspaceId}', 'Ingest E2E machine', 10, 60, 150, 1, 1,
        ${now}, ${now});
    INSERT INTO agent_enrollment_tokens
      (id, workspace_id, machine_id, token_digest, expires_at, created_by, created_at)
      VALUES ('${enrollmentId}', '${workspaceId}', '${machineId}', X'${token.digest}',
        ${now + 15 * 60_000}, '${userId}', ${now});
    INSERT INTO agent_enrollment_tokens
      (id, workspace_id, machine_id, token_digest, expires_at, created_by, created_at)
      VALUES ('${expiredEnrollmentId}', '${workspaceId}', '${machineId}', X'${expiredToken.digest}',
        ${now - 1}, '${userId}', ${now});
    INSERT INTO agent_enrollment_tokens
      (id, workspace_id, machine_id, token_digest, expires_at, revoked_at, created_by, created_at)
      VALUES ('${revokedEnrollmentId}', '${workspaceId}', '${machineId}', X'${revokedToken.digest}',
        ${now + 15 * 60_000}, ${now}, '${userId}', ${now});
  `;
  run(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "CONTROL_DB",
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
      "--command",
      seedSql,
    ],
    "Ingest E2E seed",
    { quiet: true },
  );
  run(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "TELEMETRY_DB",
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
      "--command",
      `INSERT INTO machine_latest
        (machine_pk, workspace_pk, agent_id, observed_at, received_at, state,
         cpu_permille, memory_used_bytes, memory_total_bytes, storage_used_bytes,
         storage_total_bytes, network_rx_bps, network_tx_bps, network_rx_total,
         network_tx_total, report_id)
       VALUES (1, 1, 'previous-agent', ${now - 300_000}, ${now - 300_000}, 'offline',
         0, 0, 1, 0, 1, 0, 0, 0, 0, X'00000000000000000000000000000000')`,
    ],
    "Ingest E2E offline latest seed",
    { quiet: true },
  );

  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const processOutput = { text: "", exited: false };
  child = spawn(
    pnpm,
    [
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
      "--env-file",
      envFile,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const recordOutput = (chunk) => {
    processOutput.text = `${processOutput.text}${chunk}`.slice(-16_384);
  };
  child.stdout.on("data", recordOutput);
  child.stderr.on("data", recordOutput);
  child.once("exit", () => {
    processOutput.exited = true;
  });
  await waitForServer(origin, processOutput);

  const sessionPath = join(temporary, "agent-session.json");
  try {
    run(
      process.execPath,
      [
        resolve(root, "scripts/run-cargo.mjs"),
        "run",
        "--quiet",
        "-p",
        "alphaping-ingest",
        "--example",
        "ingest_e2e_client",
        "--",
        "run",
        origin,
        token.value,
        machineId,
        expiredToken.value,
        revokedToken.value,
        sessionPath,
      ],
      "Ingest protocol client",
    );
  } catch (cause) {
    throw new Error(`${cause.message}\n${processOutput.text}`.trim(), { cause });
  }
  run(
    pnpm,
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "CONTROL_DB",
      "--local",
      "--config",
      config,
      "--persist-to",
      persistTo,
      "--command",
      `UPDATE agent_keys SET revoked_at = ${Date.now()}`,
    ],
    "Agent key revocation",
    { quiet: true },
  );
  run(
    process.execPath,
    [
      resolve(root, "scripts/run-cargo.mjs"),
      "run",
      "--quiet",
      "-p",
      "alphaping-ingest",
      "--example",
      "ingest_e2e_client",
      "--",
      "verify-revoked",
      origin,
      sessionPath,
    ],
    "Revoked Agent protocol client",
  );

  const query = (binding, sql) => {
    const result = run(
      pnpm,
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        binding,
        "--local",
        "--config",
        config,
        "--persist-to",
        persistTo,
        "--command",
        sql,
        "--json",
      ],
      `${binding} verification query`,
      { quiet: true },
    );
    const payload = jsonPayload(result.stdout);
    const execution = Array.isArray(payload) ? payload[0] : payload;
    if (!execution?.success || !Array.isArray(execution.results)) {
      throw new Error(`${binding} verification query did not return rows`);
    }
    return execution.results;
  };
  const [agent] = query(
    "CONTROL_DB",
    `SELECT a.status, a.agent_version, a.last_seen_at, t.used_at, k.revoked_at,
      LENGTH(k.wrapped_data_key) AS wrapped_key_bytes
     FROM agents a JOIN agent_keys k ON k.agent_id = a.id
     JOIN agent_enrollment_tokens t ON t.used_by_agent_id = a.id`,
  );
  if (
    agent?.status !== "active" ||
    agent.agent_version !== "business-marker-1" ||
    !Number.isInteger(agent.last_seen_at) ||
    !Number.isInteger(agent.used_at) ||
    !Number.isInteger(agent.revoked_at) ||
    agent.wrapped_key_bytes !== 60
  ) {
    throw new Error("enrollment key wrapping or Agent latest state was not persisted");
  }
  const [telemetry] = query(
    "TELEMETRY_DB",
    `SELECT
      (SELECT COUNT(*) FROM telemetry_blocks_5m) AS block_count,
      (SELECT SUM((report_0 IS NOT NULL) + (report_1 IS NOT NULL) + (report_2 IS NOT NULL) +
        (report_3 IS NOT NULL) + (report_4 IS NOT NULL)) FROM telemetry_blocks_5m)
        AS populated_slots,
      (SELECT cpu_permille FROM machine_latest WHERE machine_pk = 1) AS cpu_permille,
      (SELECT state FROM machine_latest WHERE machine_pk = 1) AS machine_state,
      (SELECT highest_sequence FROM agent_replay_state LIMIT 1) AS highest_sequence,
      (SELECT COUNT(*) FROM state_events WHERE previous_state = 'offline'
        AND current_state = 'healthy' AND reason_code = 'agent_report_received') AS recovery_events,
      (SELECT COUNT(*) FROM state_events WHERE previous_state = 'healthy'
        AND current_state = 'down' AND reason_code = 'resource_threshold') AS threshold_events`,
  );
  if (
    ![1, 2].includes(telemetry?.block_count) ||
    telemetry.populated_slots !== 2 ||
    telemetry.cpu_permille !== 980 ||
    telemetry.machine_state !== "down" ||
    telemetry.highest_sequence !== 3 ||
    telemetry.recovery_events !== 1 ||
    telemetry.threshold_events !== 1
  ) {
    throw new Error("durable telemetry, threshold transitions, or replay state is incorrect");
  }

  console.log(
    "Ingest E2E verified D1 enrollment, block slots, machine transitions, and replay state",
  );
} finally {
  if (child) await stopServer(child);
  rmSync(temporary, { force: true, recursive: true });
}
