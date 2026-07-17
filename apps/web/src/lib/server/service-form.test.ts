import { describe, expect, it } from "vitest";

import { parseServiceCheckForm } from "./service-form.js";

describe("service check form parsing", () => {
  it("keeps repeated assertions aligned and unchecked policy flags false", () => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      kind: "http",
      executorKind: "agent",
      executorAgentId: "agent-1",
      intervalSeconds: "5",
      timeoutMs: "1000",
      retryCount: "2",
      failureConfirmations: "3",
      recoveryConfirmations: "2",
      url: "https://example.com/health",
      method: "GET",
      expectedStatuses: "200",
      maxRedirects: "1",
      maxResponseBytes: "65536",
      tlsVerify: "off",
      critical: "off",
    })) {
      form.set(name, value);
    }
    const assertions = [
      ["header", "exists", "content-type", "", "down"],
      ["jsonpath", "equals", "$.ready", "true", "degraded"],
    ] as const;
    for (const [source, operator, selector, expected, severity] of assertions) {
      form.append("assertionSource", source);
      form.append("assertionOperator", operator);
      form.append("assertionSelector", selector);
      form.append("assertionExpected", expected);
      form.append("assertionSeverity", severity);
    }

    const parsed = parseServiceCheckForm(form);
    expect(parsed).toMatchObject({ retryCount: 2, critical: false, tlsVerify: false });
    expect(parsed.assertions).toEqual([
      {
        source: "header",
        operator: "exists",
        selector: "content-type",
        expected: "",
        severity: "down",
      },
      {
        source: "jsonpath",
        operator: "equals",
        selector: "$.ready",
        expected: "true",
        severity: "degraded",
      },
    ]);
  });

  it("keeps security and criticality enabled for older clients that omit new fields", () => {
    const parsed = parseServiceCheckForm(new FormData());
    expect(parsed).toMatchObject({ critical: true, tlsVerify: true });
  });
});
