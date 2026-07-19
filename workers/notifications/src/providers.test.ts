import { describe, expect, it, vi } from "vitest";

import { sendNotification } from "./providers.js";
import type { NotificationPayload } from "./types.js";

const payload: NotificationPayload = {
  workspace: "Operations",
  resourceType: "machine",
  resourceName: "edge-01",
  dimension: "availability",
  previousState: "healthy",
  currentState: "offline",
  reasonCode: "report_timeout",
  occurredAt: 1_700_000_000_000,
};

describe("notification providers", () => {
  it("sends Resend email through its HTTPS API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(
      sendNotification(
        "resend",
        { apiKey: "re_secret", from: "AlphaPing <alerts@example.com>", recipients: ["ops@example.com"] },
        payload,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: true, status: 202 });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects non-provider Discord webhook hosts without sending", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      sendNotification(
        "discord",
        { webhookUrl: "https://example.com/api/webhooks/1/token" },
        payload,
        fetcher,
      ),
    ).resolves.toMatchObject({ ok: false, retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries provider throttling without reading the response body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("ignored", { status: 429 }));
    await expect(
      sendNotification(
        "slack",
        { webhookUrl: "https://hooks.slack.com/services/T/B/secret" },
        payload,
        fetcher,
      ),
    ).resolves.toEqual({
      ok: false,
      retryable: true,
      status: 429,
      error: "provider_temporarily_unavailable",
    });
  });
});
