import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { runWebManagementE2e } from "./lib/web-management-e2e.mjs";

const root = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const arguments_ = process.argv.slice(2);
const skipBuild = arguments_.includes("--skip-build");
const inspectSetup = arguments_.includes("--inspect-setup");
const inspectManagement = arguments_.includes("--inspect-management");
if (
  arguments_.some(
    (argument) => !["--skip-build", "--inspect-setup", "--inspect-management"].includes(argument),
  ) ||
  (inspectSetup && inspectManagement)
) {
  throw new Error("Usage: test-web-e2e.mjs [--skip-build] [--inspect-setup|--inspect-management]");
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
  if (!address || typeof address === "string") throw new Error("cannot allocate E2E port");
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

function assertResponse(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(`${label} returned ${response.status}, expected ${expectedStatus}`);
  }
}

async function waitForServer(url, processOutput) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (processOutput.exited)
      throw new Error(`Web Worker exited before startup\n${processOutput.text}`);
    try {
      const response = await fetch(`${url}/setup`);
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Web Worker did not start within 30 seconds\n${processOutput.text}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}

function form(values) {
  return new URLSearchParams(values).toString();
}

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  const cookies = values.length > 0 ? values : fallback ? [fallback] : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

const temporary = mkdtempSync(join(tmpdir(), "alphaping-web-e2e-"));
const persistTo = join(temporary, "state");
const setupToken = "e2e-setup-token-32-characters-long";
const authSecret = "e2e-auth-secret-that-is-at-least-32-bytes-long";
let child = null;

class SetupInspectionComplete extends Error {}

try {
  if (!skipBuild) run(pnpm, ["--filter", "@alphaping/web", "build"], "Web build");
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

  const config = join(temporary, "wrangler.e2e.jsonc");
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        name: "alphaping-web-e2e",
        main: resolve(root, "apps/web/.svelte-kit/cloudflare/_worker.js"),
        compatibility_date: "2026-07-17",
        compatibility_flags: ["nodejs_compat"],
        assets: {
          directory: resolve(root, "apps/web/.svelte-kit/cloudflare"),
          binding: "ASSETS",
        },
        vars: {
          SETUP_TOKEN: setupToken,
          BETTER_AUTH_SECRET: authSecret,
          ENROLLMENT_TOKEN_PEPPER:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          CHECK_SECRET_WRAPPING_KEY:
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          LIVE_TICKET_SECRET: "e2e-live-ticket-secret-that-is-at-least-32-bytes-long",
          INGEST_ORIGIN: "https://ingest.example.com",
          LIVE_ORIGIN: "wss://live.example.com",
          AGENT_RELEASE_MANIFEST_JSON:
            '{"linux-x86_64":{"version":"0.1.0","length":0,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}}',
        },
        d1_databases: [
          {
            binding: "CONTROL_DB",
            database_name: "alphaping-control-e2e",
            database_id: "00000000-0000-0000-0000-000000000000",
          },
          {
            binding: "TELEMETRY_DB",
            database_name: "alphaping-telemetry-e2e",
            database_id: "00000000-0000-0000-0000-000000000000",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
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
  await waitForServer(baseUrl, processOutput);

  if (inspectSetup) {
    console.log(`Setup inspection server: ${baseUrl}/setup`);
    console.log("Press Ctrl+C to stop and remove the temporary D1 state");
    await new Promise((resolveStop) => {
      process.once("SIGINT", resolveStop);
      process.once("SIGTERM", resolveStop);
    });
    throw new SetupInspectionComplete();
  }

  let response = await fetch(baseUrl, { redirect: "manual" });
  assertResponse(response, 303, "uninitialized root");
  if (response.headers.get("location") !== "/setup")
    throw new Error("root did not redirect to setup");

  response = await fetch(`${baseUrl}/setup`);
  assertResponse(response, 200, "setup page");
  if (response.headers.get("referrer-policy") !== "same-origin") {
    throw new Error("setup referrer policy would suppress the native form Origin header");
  }
  const setupPage = await response.text();
  if (!setupPage.includes("Initialize this AlphaPing deployment")) {
    throw new Error("setup page did not render initialization UI");
  }
  for (const expected of [
    "Initialization progress",
    "Control database",
    "Telemetry database",
    "Data channel secrets",
    "Worker endpoints",
  ]) {
    if (!setupPage.includes(expected)) {
      throw new Error(`setup page omitted the ${expected} readiness check`);
    }
  }
  for (const [path, contentType, expected] of [
    ["/install.sh", "text/x-shellscript; charset=utf-8", "systemctl enable --now"],
    ["/install.ps1", "text/plain; charset=utf-8", "sc.exe failure AlphaPingAgent"],
  ]) {
    response = await fetch(`${baseUrl}${path}`);
    assertResponse(response, 200, `${path} distribution`);
    const body = await response.text();
    const checksum = createHash("sha256").update(body).digest("hex");
    if (
      response.headers.get("content-type") !== contentType ||
      response.headers.get("x-content-type-options") !== "nosniff" ||
      response.headers.get("x-alphaping-sha256") !== checksum ||
      !/^sha-256=:[A-Za-z0-9+/]{43}=:$/u.test(response.headers.get("content-digest") ?? "") ||
      !body.includes(expected)
    ) {
      throw new Error(`${path} distribution headers or service definition are incorrect`);
    }
  }

  const setupForm = {
    token: "invalid-setup-token-32-characters",
    name: "E2E Admin",
    email: "admin@example.test",
    password: "correct horse battery staple",
    workspaceName: "Operations",
    workspaceSlug: "operations",
    rawDays: "7",
  };
  response = await fetch(`${baseUrl}/setup`, {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
    },
    body: form(setupForm),
    redirect: "manual",
  });
  if (response.status !== 403) {
    const body = await response.clone().text();
    throw new Error(
      `invalid setup token returned ${response.status}; body starts with ${JSON.stringify(body.slice(0, 500))}`,
    );
  }
  assertResponse(response, 403, "invalid setup token");

  setupForm.token = setupToken;
  const competingSetupResponses = await Promise.all(
    Array.from({ length: 2 }, () =>
      fetch(`${baseUrl}/setup`, {
        method: "POST",
        headers: {
          accept: "text/html",
          "content-type": "application/x-www-form-urlencoded",
          origin: baseUrl,
        },
        body: form(setupForm),
        redirect: "manual",
      }),
    ),
  );
  const setupStatuses = competingSetupResponses.map(({ status }) => status).sort();
  if (setupStatuses[0] !== 303 || setupStatuses[1] !== 409) {
    throw new Error(`concurrent setup returned ${setupStatuses.join(", ")}, expected 303, 409`);
  }
  response = competingSetupResponses.find(({ status }) => status === 303);
  if (!response) throw new Error("concurrent setup omitted its successful response");
  if (response.headers.get("location") !== "/setup") {
    throw new Error("initialization did not redirect to the completion step");
  }

  response = await fetch(`${baseUrl}/setup`);
  assertResponse(response, 200, "setup completion");
  const completionPage = await response.text();
  for (const expected of ["Initialization complete", "Add first machine", "Add service monitor"]) {
    if (!completionPage.includes(expected)) {
      throw new Error(`setup completion omitted ${expected}`);
    }
  }

  response = await fetch(`${baseUrl}/setup`, {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
    },
    body: form(setupForm),
    redirect: "manual",
  });
  assertResponse(response, 409, "repeated initialization");

  const loginHeaders = {
    accept: "text/html",
    "content-type": "application/x-www-form-urlencoded",
    origin: baseUrl,
  };
  response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: loginHeaders,
    body: form({
      email: setupForm.email,
      password: "incorrect password",
      returnTo: "/",
    }),
    redirect: "manual",
  });
  assertResponse(response, 400, "invalid administrator login");
  if (cookieHeader(response)) throw new Error("invalid login issued a session cookie");

  response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: loginHeaders,
    body: form({
      email: setupForm.email,
      password: setupForm.password,
      returnTo: "/",
    }),
    redirect: "manual",
  });
  assertResponse(response, 303, "administrator login");
  const cookie = cookieHeader(response);
  if (!cookie.includes("alphaping"))
    throw new Error("login did not issue an AlphaPing session cookie");

  response = await fetch(baseUrl, { headers: { cookie }, redirect: "manual" });
  assertResponse(response, 303, "authenticated root");
  if (response.headers.get("location") !== "/operations") {
    throw new Error("authenticated root did not select the initialized workspace");
  }
  response = await fetch(`${baseUrl}/operations`, { headers: { cookie } });
  assertResponse(response, 200, "authenticated dashboard");
  if (response.headers.get("cache-control") !== "private, no-store") {
    throw new Error("authenticated dashboard was not marked private");
  }

  const queryD1 = (binding, sql) => {
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
      `${binding} query`,
      { quiet: true },
    );
    const output = result.stdout.trim();
    const jsonStart = output.lastIndexOf("\n[");
    const payload = JSON.parse(jsonStart === -1 ? output : output.slice(jsonStart + 1));
    const execution = Array.isArray(payload) ? payload[0] : payload;
    if (!execution?.success || !Array.isArray(execution.results)) {
      throw new Error(`${binding} query did not return rows`);
    }
    return execution.results;
  };
  await runWebManagementE2e({
    baseUrl,
    adminCookie: cookie,
    queryControlDb: (sql) => queryD1("CONTROL_DB", sql),
    queryTelemetryDb: (sql) => queryD1("TELEMETRY_DB", sql),
  });

  if (inspectManagement) {
    console.log(`Management inspection server: ${baseUrl}/login`);
    console.log(
      "Sign in as admin@example.test; press Ctrl+C to stop and remove temporary D1 state",
    );
    await new Promise((resolveStop) => {
      process.once("SIGINT", resolveStop);
      process.once("SIGTERM", resolveStop);
    });
    throw new SetupInspectionComplete();
  }

  console.log("Web E2E setup, management, RBAC, dashboard, and public status flows passed");
} catch (cause) {
  if (!(cause instanceof SetupInspectionComplete)) throw cause;
} finally {
  if (child) await stopServer(child);
  rmSync(temporary, { force: true, recursive: true });
}
