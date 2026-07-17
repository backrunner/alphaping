import { describe, expect, it } from "vitest";

import { decodeHistoryCursor, encodeHistoryCursor, HistoryCursorError } from "./history-cursor.js";

describe("history cursor", () => {
  it("round trips a resolution-bound position", () => {
    const cursor = encodeHistoryCursor("raw", 1_752_580_800_000);
    expect(decodeHistoryCursor(cursor, "raw")).toBe(1_752_580_800_000);
    expect(() => decodeHistoryCursor(cursor, "5m")).toThrow(HistoryCursorError);
  });

  it("rejects malformed and unbounded cursors", () => {
    expect(() => decodeHistoryCursor("not-json", "1h")).toThrow(HistoryCursorError);
    expect(() => decodeHistoryCursor("a".repeat(129), "1h")).toThrow(HistoryCursorError);
    expect(() => encodeHistoryCursor("5m", Number.NaN)).toThrow(HistoryCursorError);
  });
});
