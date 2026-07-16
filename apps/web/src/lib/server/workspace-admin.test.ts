import { describe, expect, it } from "vitest";

import { maskEmail, safeLocalPath } from "./workspace-admin.js";

describe("workspace administration boundaries", () => {
  it("accepts only local return paths", () => {
    expect(safeLocalPath("/invite/token")).toBe("/invite/token");
    expect(safeLocalPath("https://attacker.example/path")).toBe("/");
    expect(safeLocalPath("//attacker.example/path")).toBe("/");
    expect(safeLocalPath("/safe\\redirect")).toBe("/");
  });

  it("does not expose the full invitation email", () => {
    expect(maskEmail("operator@example.com")).toBe("op******@example.com");
    expect(maskEmail("a@example.com")).toBe("a**@example.com");
  });
});
