import { describe, expect, it } from "vitest";

import { applyConfirmationWindow, serviceState } from "./persistence.js";
import type { CheckConfigRow, ExecutedCheck } from "./types.js";

const config: CheckConfigRow = {
  id: "check",
  telemetry_pk: 1,
  workspace_telemetry_pk: 1,
  workspace_id: "workspace",
  service_telemetry_pk: 1,
  service_maintenance_until: null,
  config_revision: 1,
  kind: "http",
  interval_seconds: 60,
  phase_seconds: 0,
  timeout_ms: 5_000,
  retry_count: 0,
  critical: 1,
  request_json: "{}",
  secret_refs_json: "{}",
  failure_confirmations: 3,
  recovery_confirmations: 2,
  last_claimed_slot: 0,
};

const down: ExecutedCheck = {
  state: "down",
  latencyMs: null,
  failureCode: "timeout",
  failureSummary: null,
};

describe("check confirmation windows", () => {
  it("degrades for a non-critical failure and fails for a critical one", () => {
    expect(
      serviceState(
        [
          { state: "healthy", critical: 1 },
          { state: "down", critical: 0 },
        ],
        null,
        1,
      ),
    ).toBe("degraded");
    expect(serviceState([{ state: "down", critical: 1 }], null, 1)).toBe("down");
  });

  it("keeps a healthy check healthy until the failure threshold", () => {
    const first = applyConfirmationWindow(
      config,
      {
        state: "healthy",
        failure_code: null,
        failure_summary: null,
        consecutive_failures: 0,
        consecutive_successes: 10,
      },
      down,
    );
    expect(first).toMatchObject({
      state: "healthy",
      consecutiveFailures: 1,
      failureCode: "failure_pending",
    });
    const second = applyConfirmationWindow(
      config,
      {
        state: first.state,
        failure_code: first.failureCode,
        failure_summary: first.failureSummary,
        consecutive_failures: first.consecutiveFailures,
        consecutive_successes: first.consecutiveSuccesses,
      },
      down,
    );
    const third = applyConfirmationWindow(
      config,
      {
        state: second.state,
        failure_code: second.failureCode,
        failure_summary: second.failureSummary,
        consecutive_failures: second.consecutiveFailures,
        consecutive_successes: second.consecutiveSuccesses,
      },
      down,
    );
    expect(second.state).toBe("healthy");
    expect(third).toMatchObject({ state: "down", consecutiveFailures: 3, failureCode: "timeout" });
  });

  it("requires consecutive successes before recovery", () => {
    const healthy: ExecutedCheck = {
      state: "healthy",
      latencyMs: 20,
      failureCode: null,
      failureSummary: null,
    };
    const first = applyConfirmationWindow(
      config,
      {
        state: "down",
        failure_code: "timeout",
        failure_summary: null,
        consecutive_failures: 5,
        consecutive_successes: 0,
      },
      healthy,
    );
    const second = applyConfirmationWindow(
      config,
      {
        state: first.state,
        failure_code: first.failureCode,
        failure_summary: first.failureSummary,
        consecutive_failures: first.consecutiveFailures,
        consecutive_successes: first.consecutiveSuccesses,
      },
      healthy,
    );
    expect(first.state).toBe("down");
    expect(second).toMatchObject({ state: "healthy", consecutiveSuccesses: 2, failureCode: null });
  });
});
