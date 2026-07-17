import { spawn, spawnSync } from "node:child_process";
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
  throw new Error("Usage: test-web-e2e.mjs [--skip-build]");
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

  let response = await fetch(baseUrl, { redirect: "manual" });
  assertResponse(response, 303, "uninitialized root");
  if (response.headers.get("location") !== "/setup")
    throw new Error("root did not redirect to setup");

  response = await fetch(`${baseUrl}/setup`);
  assertResponse(response, 200, "setup page");
  if (!(await response.text()).includes("Initialize this AlphaPing deployment")) {
    throw new Error("setup page did not render initialization UI");
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
  assertResponse(response, 303, "initialization");
  if (response.headers.get("location") !== "/login?workspace=operations") {
    throw new Error("initialization did not redirect to workspace login");
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
      "UPDATE dashboards SET visibility = 'public' WHERE slug = 'overview'",
    ],
    "publish dashboard",
    { quiet: true },
  );
  response = await fetch(`${baseUrl}/status/operations`);
  assertResponse(response, 200, "public status page");
  if (response.headers.get("cache-control") !== "public, max-age=30, stale-while-revalidate=300") {
    throw new Error("public status page cache policy is incorrect");
  }

  console.log("Web E2E setup, authentication, dashboard, and public status flow passed");
} finally {
  if (child) await stopServer(child);
  rmSync(temporary, { force: true, recursive: true });
}
