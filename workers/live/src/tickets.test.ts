import { describe, expect, it } from "vitest";

import { verifyLiveTicket } from "./tickets.js";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

describe("live tickets", () => {
  it("accepts a valid short-lived HMAC ticket", async () => {
    const secret = "test-secret-with-sufficient-entropy";
    const payload = base64Url(
      new TextEncoder().encode(
        JSON.stringify({
          workspaceId: "workspace-1",
          subjectId: "viewer-1",
          role: "viewer",
          topics: ["machine:1"],
          expiresAt: 10_000,
        }),
      ),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    );

    await expect(
      verifyLiveTicket(`${payload}.${base64Url(signature)}`, secret, 1_000),
    ).resolves.toMatchObject({
      workspaceId: "workspace-1",
      role: "viewer",
    });
  });
});
