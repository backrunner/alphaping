import { describe, expect, it } from "vitest";

import { parseMachineLiveFallback, parseMachineLiveTicket } from "./machine-live.js";

describe("machine live browser boundaries", () => {
  it("accepts bounded tickets and durable projections", () => {
    expect(
      parseMachineLiveTicket(
        {
          url: "wss://live.example.test/v1/live/workspace-1",
          ticket: "payload.signature",
          topic: "machine:7",
          expiresAt: 20_000,
        },
        10_000,
      ),
    ).toMatchObject({ topic: "machine:7" });
    expect(
      parseMachineLiveFallback({
        latest: {
          id: "machine-1",
          name: "Build runner",
          labels: { region: "sin" },
          state: "healthy",
          observedAt: 10_000,
          cpuPermille: 420,
          memoryUsedBytes: 2_048,
          memoryTotalBytes: 8_192,
          storageUsedBytes: 4_096,
          storageTotalBytes: 16_384,
          networkRxBps: 512,
          networkTxBps: 256,
          networkRxTotal: 65_536,
          networkTxTotal: 32_768,
          agentVersion: "0.1.0",
          platform: "linux",
          arch: "x86_64",
          containersEnabled: true,
        },
      }),
    ).toMatchObject({ state: "healthy", cpuPermille: 420 });
  });

  it("rejects plaintext sockets, expired tickets, and malformed metrics", () => {
    expect(() =>
      parseMachineLiveTicket(
        {
          url: "ws://live.example.test",
          ticket: "payload.signature",
          topic: "machine:7",
          expiresAt: 20_000,
        },
        10_000,
      ),
    ).toThrow("invalid_live_ticket_response");
    expect(() =>
      parseMachineLiveTicket(
        {
          url: "wss://live.example.test",
          ticket: "payload.signature",
          topic: "machine:7",
          expiresAt: 10_000,
        },
        10_000,
      ),
    ).toThrow("invalid_live_ticket_response");
    expect(() => parseMachineLiveFallback({ latest: { state: "healthy" } })).toThrow(
      "invalid_live_fallback",
    );
  });
});
