import { describe, expect, it } from "vitest";

import { evaluateSetupEnvironment, type SetupEnvironmentSnapshot } from "./setup-environment";

const readySnapshot: SetupEnvironmentSnapshot = {
  controlTables: [
    "account",
    "dashboards",
    "installations",
    "memberships",
    "retention_policies",
    "telemetry_resource_sequences",
    "user",
    "workspaces",
  ],
  telemetryTables: [
    "check_result_blocks_5m",
    "machine_latest",
    "retention_cursors",
    "telemetry_blocks_5m",
  ],
  betterAuthSecret: "auth-secret-with-more-than-thirty-two-bytes",
  setupToken: "setup-token-with-more-than-thirty-two-bytes",
  enrollmentTokenPepper: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  checkSecretWrappingKey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  liveTicketSecret: "live-ticket-secret-with-more-than-thirty-two-bytes",
  ingestOrigin: "https://ingest.example.test",
  liveOrigin: "wss://live.example.test",
  webCryptoAvailable: true,
};

describe("setup environment", () => {
  it("requires both migrated databases and every security boundary", () => {
    const report = evaluateSetupEnvironment(readySnapshot);
    expect(report.ready).toBe(true);
    expect(report.checks).toHaveLength(5);
    expect(report.checks.every((check) => check.ready)).toBe(true);
  });

  it("rejects template secrets, missing migrations, and plaintext origins", () => {
    const report = evaluateSetupEnvironment({
      ...readySnapshot,
      telemetryTables: ["machine_latest"],
      setupToken: "replace-with-at-least-32-random-bytes",
      enrollmentTokenPepper: "0".repeat(64),
      ingestOrigin: "http://127.0.0.1:8788",
    });
    expect(report.ready).toBe(false);
    expect(report.checks.filter((check) => !check.ready).map((check) => check.id)).toEqual([
      "telemetry-db",
      "auth-secrets",
      "data-secrets",
      "worker-runtime",
    ]);
  });

  it("rejects oversized text secrets", () => {
    const report = evaluateSetupEnvironment({
      ...readySnapshot,
      betterAuthSecret: "a".repeat(513),
      liveTicketSecret: "l".repeat(513),
    });

    expect(report.ready).toBe(false);
    expect(report.checks.filter((check) => !check.ready).map((check) => check.id)).toEqual([
      "auth-secrets",
      "data-secrets",
    ]);
  });

  it("requires endpoint values to be pure secure origins", () => {
    const report = evaluateSetupEnvironment({
      ...readySnapshot,
      ingestOrigin: "https://operator:secret@ingest.example.test/v1/report",
      liveOrigin: "wss://live.example.test/socket?tenant=operations",
    });

    expect(report.ready).toBe(false);
    expect(report.checks.filter((check) => !check.ready).map((check) => check.id)).toEqual([
      "worker-runtime",
    ]);
  });
});
