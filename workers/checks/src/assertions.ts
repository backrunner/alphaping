import { JSONPath } from "jsonpath-plus";
import { RE2JS } from "re2js";

import type { CheckAssertion } from "./types.js";

export interface AssertionEvaluation {
  state: "healthy" | "degraded" | "down";
  failureCode: string | null;
  failureSummary: string | null;
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }
  if (
    typeof left === "object" &&
    left !== null &&
    !Array.isArray(left) &&
    typeof right === "object" &&
    right !== null &&
    !Array.isArray(right)
  ) {
    const leftEntries = Object.entries(left);
    const rightRecord = right as Readonly<Record<string, unknown>>;
    return (
      leftEntries.length === Object.keys(rightRecord).length &&
      leftEntries.every(([key, value]) => structurallyEqual(value, rightRecord[key]))
    );
  }
  return false;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function compare(candidate: unknown, assertion: CheckAssertion): boolean {
  if (assertion.operator === "exists") return candidate !== undefined;
  if (assertion.operator === "equals") return structurallyEqual(candidate, assertion.expected);
  if (assertion.operator === "contains") {
    if (typeof candidate === "string" && typeof assertion.expected === "string") {
      return candidate.includes(assertion.expected);
    }
    return (
      Array.isArray(candidate) &&
      candidate.some((item) => structurallyEqual(item, assertion.expected))
    );
  }
  if (assertion.operator === "matches") {
    if (typeof candidate !== "string" || typeof assertion.expected !== "string") return false;
    return RE2JS.compile(assertion.expected).matcher(candidate).find();
  }
  if (assertion.operator === "type") {
    return typeof assertion.expected === "string" && valueType(candidate) === assertion.expected;
  }
  if (assertion.operator === "greater_than") {
    return (
      typeof candidate === "number" &&
      typeof assertion.expected === "number" &&
      candidate > assertion.expected
    );
  }
  return (
    typeof candidate === "number" &&
    typeof assertion.expected === "number" &&
    candidate < assertion.expected
  );
}

function bodyCandidates(
  assertion: CheckAssertion,
  body: string,
  parsedJson: unknown,
): readonly unknown[] {
  if (assertion.source === "body") return [body];
  if (assertion.source !== "jsonpath" || assertion.selector === null || parsedJson === undefined) {
    return [];
  }
  try {
    const selected = JSONPath({
      path: assertion.selector,
      json: parsedJson,
      wrap: true,
      eval: false,
    });
    return Array.isArray(selected) ? selected : [selected];
  } catch {
    return [];
  }
}

export function evaluateAssertions(
  assertions: readonly CheckAssertion[],
  headers: Headers,
  body: string,
): AssertionEvaluation {
  let parsedJson: unknown = undefined;
  if (assertions.some((assertion) => assertion.source === "jsonpath")) {
    try {
      parsedJson = JSON.parse(body) as unknown;
    } catch {
      parsedJson = undefined;
    }
  }

  const failures: { severity: "degraded" | "down"; summary: string }[] = [];
  for (const assertion of assertions) {
    const candidates =
      assertion.source === "header"
        ? [assertion.selector === null ? undefined : (headers.get(assertion.selector) ?? undefined)]
        : bodyCandidates(assertion, body, parsedJson);
    const passed = (() => {
      try {
        return assertion.operator === "exists"
          ? candidates.length > 0 && candidates.some((candidate) => candidate !== undefined)
          : candidates.some((candidate) => compare(candidate, assertion));
      } catch {
        return false;
      }
    })();
    if (!passed) {
      failures.push({
        severity: assertion.severity,
        summary: `${assertion.source}:${assertion.operator}`,
      });
    }
  }
  if (failures.length === 0) {
    return { state: "healthy", failureCode: null, failureSummary: null };
  }
  return {
    state: failures.some((failure) => failure.severity === "down") ? "down" : "degraded",
    failureCode: "assertion_failed",
    failureSummary: failures
      .slice(0, 3)
      .map((failure) => failure.summary)
      .join(","),
  };
}
