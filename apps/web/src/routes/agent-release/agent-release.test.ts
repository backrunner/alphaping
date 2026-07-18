import { describe, expect, it } from "vitest";

import { GET } from "./[target]/+server.js";

function requestManifest(manifest: string): Response {
  return GET({
    params: { target: "linux-x86_64" },
    platform: { env: { AGENT_RELEASE_MANIFEST_JSON: manifest } },
  } as never) as Response;
}

describe("Agent release manifest", () => {
  it("rejects JSON values that are not manifest objects with a controlled error", () => {
    for (const manifest of ["null", "[]", '"release"']) {
      expect(() => requestManifest(manifest)).toThrowError(
        expect.objectContaining({ status: 503 }),
      );
    }
  });

  it("returns a validated release target", async () => {
    const response = requestManifest(
      JSON.stringify({
        "linux-x86_64": {
          version: "1.2.3",
          length: 1024,
          sha256: "a".repeat(64),
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("1.2.3 1024");
  });
});
