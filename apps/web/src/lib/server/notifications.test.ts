import { describe, expect, it } from "vitest";

import { parseNotificationChannelConfig } from "./notifications.js";

describe("notification channel validation", () => {
  it("normalizes Resend recipients without retaining unrelated fields", () => {
    expect(
      parseNotificationChannelConfig("resend", {
        apiKey: "re_secret",
        from: "AlphaPing <alerts@example.com>",
        recipients: "ops@example.com, dev@example.com\nops@example.com",
        relayToken: "must-not-leak",
      }),
    ).toEqual({
      apiKey: "re_secret",
      from: "AlphaPing <alerts@example.com>",
      recipients: ["ops@example.com", "dev@example.com"],
      replyTo: null,
    });
  });

  it("supports SMTP only through an HTTPS relay", () => {
    expect(() =>
      parseNotificationChannelConfig("smtp", {
        relayUrl: "smtp://mail.example.com:587",
        from: "alerts@example.com",
        recipients: "ops@example.com",
      }),
    ).toThrow();
  });

  it("restricts provider webhooks to their official hosts", () => {
    expect(() =>
      parseNotificationChannelConfig("slack", {
        webhookUrl: "https://example.com/services/T/B/token",
      }),
    ).toThrow();
    expect(
      parseNotificationChannelConfig("discord", {
        webhookUrl: "https://discord.com/api/webhooks/123/token",
      }),
    ).toEqual({ webhookUrl: "https://discord.com/api/webhooks/123/token" });
  });
});
