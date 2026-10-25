import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Keep the event loop available while Wrangler reads or seeds D1. Blocking it
// prevents HTTP clients from processing keep-alive socket closure notifications.
export async function runE2eCommand(command, args, label, options = {}) {
  try {
    return await execFileAsync(command, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (cause) {
    throw new Error(
      `${label} failed (code ${cause.code ?? "none"}, signal ${cause.signal ?? "none"}): ${(cause.stderr || cause.stdout || cause.message).trim().slice(-8_192)}`,
      { cause },
    );
  }
}
