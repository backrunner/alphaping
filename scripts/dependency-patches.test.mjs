import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// Resolve the installed copy actually used by the documentation content scanner.
const svedocsRequire = createRequire(
  realpathSync(new URL("../apps/docs/node_modules/svedocs/package.json", import.meta.url)),
);
const globRequire = createRequire(svedocsRequire.resolve("fast-glob"));
const micromatchRequire = createRequire(globRequire.resolve("micromatch"));
const braces = micromatchRequire("braces");
const depthError = { name: "SyntaxError", message: /maximum nesting depth/ };

test("braces patch rejects deeply nested patterns before recursive traversal", () => {
  for (const pattern of [
    "{".repeat(4_000) + "a,b" + "}".repeat(4_000),
    "(".repeat(4_000) + "a" + ")".repeat(4_000),
    "{".repeat(4_000) + "a,b",
  ]) {
    for (const method of ["parse", "compile", "expand", "stringify"]) {
      assert.throws(() => braces[method](pattern), depthError, method);
    }
  }
});

test("braces patch also bounds direct AST traversal", () => {
  for (const method of ["compile", "expand", "stringify"]) {
    let ast = { type: "text", value: "a" };
    for (let depth = 0; depth < 1_000; depth += 1) {
      ast = { type: "root", nodes: [ast] };
    }
    assert.throws(() => braces[method](ast), depthError, method);
  }
});

test("braces patch preserves normal docs globs, ranges and escaped braces", () => {
  assert.deepEqual(braces.expand("content/{docs,pages}/**/*.{md,mdx,svx}"), [
    "content/docs/**/*.md",
    "content/docs/**/*.mdx",
    "content/docs/**/*.svx",
    "content/pages/**/*.md",
    "content/pages/**/*.mdx",
    "content/pages/**/*.svx",
  ]);
  assert.deepEqual(braces.expand("page-{1..3}"), ["page-1", "page-2", "page-3"]);
  assert.equal(braces.stringify("a/\\{b,c\\}/d"), "a/{b,c}/d");
});
