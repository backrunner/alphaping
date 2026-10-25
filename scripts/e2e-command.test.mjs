import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { runE2eCommand } from "./lib/run-e2e-command.mjs";

test("E2E database commands let the HTTP server and client process socket closures", async () => {
  const server = createServer((_request, response) => response.end("ready"));
  server.keepAliveTimeout = 10;
  server.keepAliveTimeoutBuffer = 0;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(url);
    assert.equal(await response.text(), "ready");
    const result = await runE2eCommand(
      process.execPath,
      [
        "-e",
        "fetch(process.argv[1], { signal: AbortSignal.timeout(5_000) }).then(response => response.text()).then(console.log)",
        url,
      ],
      "D1 fixture query",
    );
    assert.equal(result.stdout.trim(), "ready", "HTTP I/O must progress during the command");
    assert.equal(await (await fetch(url)).text(), "ready");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("E2E command failures retain the query label, exit status, and stderr", async () => {
  await assert.rejects(
    runE2eCommand(
      process.execPath,
      ["-e", "console.error('invalid SQL fixture'); process.exit(2)"],
      "CONTROL_DB query",
    ),
    (error) => {
      assert.match(error.message, /CONTROL_DB query failed \(code 2/);
      assert.match(error.message, /invalid SQL fixture/);
      assert.equal(error.cause.code, 2);
      return true;
    },
  );
});

test("HTTP requests survive idle connection closure during a slow E2E query", async () => {
  // A separate process must expire sockets while the test command is running.
  // Node 24.21 fetch can reuse a closed socket if spawnSync blocks its event loop.
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    `
      import { createServer } from 'node:http';
      const server = createServer((_request, response) => {
        response.setHeader('Keep-Alive', 'timeout=60');
        response.end('ready');
      });
      server.keepAliveTimeout = 50;
      server.keepAliveTimeoutBuffer = 0;
      server.listen(0, '127.0.0.1', () => console.log(server.address().port));
    `,
  ]);
  const exit = once(child, "exit");
  try {
    const [port] = await once(child.stdout, "data");
    const url = `http://127.0.0.1:${Number(port)}`;
    // Prime both pooled connections before simulating a slow Wrangler command.
    for (let index = 0; index < 2; index += 1) {
      assert.equal(await (await fetch(url)).text(), "ready");
    }
    await runE2eCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 300)"],
      "slow D1 fixture query",
    );
    assert.equal(await (await fetch(url)).text(), "ready");
  } finally {
    child.kill();
    await exit;
  }
});
