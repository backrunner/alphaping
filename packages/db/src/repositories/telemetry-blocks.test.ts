import { describe, expect, it } from "vitest";

import { prepareTelemetryBlockWrite } from "./telemetry-blocks.js";

describe("prepareTelemetryBlockWrite", () => {
  it("updates only the deterministic minute slot and guards conflicts", () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const write = prepareTelemetryBlockWrite({
      machinePk: 7,
      workspacePk: 2,
      nominalMinute: Date.UTC(2026, 6, 15, 12, 38),
      reportId: bytes,
      payloadHash: bytes,
      payload: bytes,
      schemaVersion: 1,
    });

    expect(write.slot).toBe(3);
    expect(write.query).toContain("report_3 = excluded.report_3");
    expect(write.query).toContain("report_id_3 IS NULL");
    expect(write.query).not.toContain("report_2 = excluded.report_2");
  });
});
