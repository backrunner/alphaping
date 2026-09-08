import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const stopping = new WeakMap();

export function forwardTerminationSignals(child) {
  const stop = () => {
    void stopProcessTree(child).catch((error) => {
      console.error("Test server cleanup failed:", error.message);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("close", () => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  });
}

// Unix callers must spawn with detached: true so only their own process group is signalled.
export function stopProcessTree(child) {
  const existing = stopping.get(child);
  if (existing) return existing;
  const operation = stop(child);
  stopping.set(child, operation);
  return operation;
}

async function stop(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  const signal = (value) => {
    try {
      process.kill(-child.pid, value);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const exited = child.exitCode !== null || child.signalCode !== null;
  const exit = exited ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve));
  signal("SIGTERM");
  await Promise.race([exit, delay(5_000, undefined, { ref: false })]);
  // pnpm may exit before Wrangler/workerd; remove any remaining descendants as well.
  signal("SIGKILL");
}
