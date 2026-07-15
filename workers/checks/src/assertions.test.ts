import { describe, expect, it } from "vitest";

import { evaluateAssertions } from "./assertions.js";
import type { CheckAssertion } from "./types.js";

describe("HTTP assertion evaluation", () => {
  it("evaluates headers, JSONPath and body patterns without exposing values", () => {
    const assertions: readonly CheckAssertion[] = [
      {
        source: "header",
        operator: "equals",
        selector: "x-release",
        expected: "stable",
        severity: "down",
      },
      {
        source: "jsonpath",
        operator: "equals",
        selector: "$.data.ready",
        expected: true,
        severity: "down",
      },
      {
        source: "body",
        operator: "matches",
        selector: null,
        expected: "ready.*true",
        severity: "degraded",
      },
    ];
    const result = evaluateAssertions(
      assertions,
      new Headers({ "x-release": "stable" }),
      JSON.stringify({ data: { ready: true } }),
    );
    expect(result).toEqual({ state: "healthy", failureCode: null, failureSummary: null });
  });

  it("returns the strongest severity and bounded structural summaries", () => {
    const assertions: readonly CheckAssertion[] = [
      {
        source: "header",
        operator: "exists",
        selector: "x-required",
        expected: null,
        severity: "degraded",
      },
      {
        source: "jsonpath",
        operator: "greater_than",
        selector: "$.queue.depth",
        expected: 20,
        severity: "down",
      },
    ];
    const result = evaluateAssertions(assertions, new Headers(), '{"queue":{"depth":3}}');
    expect(result.state).toBe("down");
    expect(result.failureCode).toBe("assertion_failed");
    expect(result.failureSummary).toBe("header:exists,jsonpath:greater_than");
    expect(JSON.stringify(result)).not.toContain("x-required");
  });
});
