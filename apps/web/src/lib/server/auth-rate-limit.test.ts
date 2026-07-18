import { describe, expect, it, vi } from "vitest";

import { allowCredentialAttempt, emailFromBetterAuthRequest } from "./auth-rate-limit.js";

function limiter(success: boolean): RateLimit {
  return { limit: vi.fn(async () => ({ success })) };
}

describe("credential rate limiting", () => {
  it("uses a trusted Cloudflare address and a normalized account digest", async () => {
    const edge = limiter(true);
    const account = limiter(true);

    await expect(
      allowCredentialAttempt(
        edge,
        account,
        new Headers({ "cf-connecting-ip": "2001:DB8::1" }),
        " Operator@Example.com ",
      ),
    ).resolves.toBe(true);
    expect(edge.limit).toHaveBeenCalledWith({ key: "client:2001:db8::1" });
    expect(account.limit).toHaveBeenCalledWith({
      key: expect.stringMatching(/^account:[0-9a-f]{64}$/),
    });

    const repeated = limiter(true);
    await allowCredentialAttempt(edge, repeated, new Headers(), "operator@example.com");
    expect(repeated.limit).toHaveBeenCalledWith(vi.mocked(account.limit).mock.calls[0]?.[0]);
  });

  it("fails closed when either limiter rejects the attempt", async () => {
    const edge = limiter(false);
    const account = limiter(true);

    await expect(allowCredentialAttempt(edge, account, new Headers(), "invalid")).resolves.toBe(
      false,
    );
    expect(edge.limit).toHaveBeenCalledWith({ key: "client:unknown" });
  });

  it("extracts only a string email from Better Auth JSON", async () => {
    await expect(
      emailFromBetterAuthRequest(
        new Request("https://example.com/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "operator@example.com", password: "secret" }),
        }),
      ),
    ).resolves.toBe("operator@example.com");
    await expect(
      emailFromBetterAuthRequest(
        new Request("https://example.com/api/auth/sign-in/email", {
          method: "POST",
          body: "not json",
        }),
      ),
    ).resolves.toBe("");
  });
});
