import { describe, expect, it } from "vitest";

import { unwrapNotificationConfig, wrapNotificationConfig } from "./notification-config.js";

const KEY = "42".repeat(32);

describe("notification config envelope", () => {
  it("round trips structured channel configuration", async () => {
    const wrapped = await wrapNotificationConfig(
      { apiKey: "secret", recipients: ["ops@example.com"] },
      KEY,
      "workspace-a",
      "channel-a",
    );
    await expect(
      unwrapNotificationConfig(wrapped, KEY, "workspace-a", "channel-a"),
    ).resolves.toEqual({ apiKey: "secret", recipients: ["ops@example.com"] });
  });

  it("binds ciphertext to its workspace and channel", async () => {
    const wrapped = await wrapNotificationConfig(
      { webhookUrl: "https://example.com/hook" },
      KEY,
      "workspace-a",
      "channel-a",
    );
    await expect(
      unwrapNotificationConfig(wrapped, KEY, "workspace-a", "channel-b"),
    ).rejects.toThrow();
  });

  it("rejects invalid wrapping keys", async () => {
    await expect(
      wrapNotificationConfig({ token: "secret" }, "short", "workspace", "channel"),
    ).rejects.toThrow("invalid_notification_wrapping_key");
  });
});
