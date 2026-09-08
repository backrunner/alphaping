import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The anti-FOUC theme bootstrap in app.html is an inline script, which the
// CSP (svelte.config.js, mode "auto") blocks unless its sha256 hash is listed
// in script-src. Any edit to the script — including whitespace — changes the
// hash. This test fails loudly when the two drift apart.

const webRoot = fileURLToPath(new URL("..", import.meta.url));

function inlineBootstrapHash(): string {
  const html = readFileSync(`${webRoot}/src/app.html`, "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match || match[1] === undefined) {
    throw new Error("no inline <script> found in app.html");
  }
  const digest = createHash("sha256").update(match[1], "utf8").digest("base64");
  return `sha256-${digest}`;
}

describe("theme bootstrap CSP hash", () => {
  it("script-src allowlists the exact inline script in app.html", () => {
    const config = readFileSync(`${webRoot}/svelte.config.js`, "utf8");
    expect(config).toContain(`"${inlineBootstrapHash()}"`);
  });
});
