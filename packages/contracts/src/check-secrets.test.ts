import { describe, expect, it } from "vitest";

import { unwrapCheckSecret, wrapCheckSecret } from "./check-secrets.js";

const KEY = "7f".repeat(32);

describe("check secret wrapping", () => {
  it("round trips only within the bound workspace and secret", async () => {
    const wrapped = await wrapCheckSecret("Bearer private", KEY, "workspace-a", "secret-a");
    await expect(unwrapCheckSecret(wrapped, KEY, "workspace-a", "secret-a")).resolves.toBe(
      "Bearer private",
    );
    await expect(unwrapCheckSecret(wrapped, KEY, "workspace-b", "secret-a")).rejects.toThrow();
  });

  it("rejects malformed keys and empty values", async () => {
    await expect(wrapCheckSecret("value", "short", "workspace", "secret")).rejects.toThrow(
      "invalid_check_secret_wrapping_key",
    );
    await expect(wrapCheckSecret("", KEY, "workspace", "secret")).rejects.toThrow(
      "invalid_check_secret_size",
    );
  });
});
