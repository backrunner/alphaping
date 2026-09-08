import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { stopProcessTree } from "./lib/stop-process-tree.mjs";

test(
  "stopping a test server also stops its spawned runtime",
  { skip: process.platform === "win32", timeout: 15000 },
  async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
    const { spawn } = require('node:child_process');
    const runtime = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(runtime.pid);
    setInterval(() => {}, 1000);
  `,
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      const [output] = await once(child.stdout, "data");
      const runtimePid = Number(output.toString().trim());
      assert.ok(Number.isInteger(runtimePid) && runtimePid > 0);
      await stopProcessTree(child);
      let stopped = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          process.kill(runtimePid, 0);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
          stopped = true;
          break;
        }
        await delay(100);
      }
      assert.ok(stopped, "runtime must not outlive the wrapper");
    } finally {
      await stopProcessTree(child);
    }
  },
);
