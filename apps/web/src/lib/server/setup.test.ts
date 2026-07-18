import { describe, expect, it } from "vitest";

import { initializeInstallation } from "./setup.js";

const setupToken = "s".repeat(32);
const unreachableDatabase = new Proxy(
  {},
  {
    get() {
      throw new Error("invalid setup input reached the database");
    },
  },
) as D1Database;

const validInput = {
  token: setupToken,
  name: "AlphaPing Administrator",
  email: "admin@example.test",
  password: "correct horse battery staple",
  workspaceName: "Operations",
  workspaceSlug: "operations",
  rawDays: 7,
  defaultSamplingIntervalSeconds: 10,
  dashboardVisibility: "private" as const,
};

describe("installation setup validation", () => {
  it.each([
    ["short administrator name", { name: "a" }],
    ["long administrator name", { name: "a".repeat(81) }],
    ["invalid administrator email", { email: "not-an-email" }],
    ["long administrator email", { email: `${"a".repeat(250)}@example.test` }],
    ["short password", { password: "short" }],
    ["long password", { password: "p".repeat(129) }],
    ["short workspace name", { workspaceName: "a" }],
    ["long workspace name", { workspaceName: "w".repeat(81) }],
  ])("rejects %s before accessing D1", async (_label, override) => {
    await expect(
      initializeInstallation(unreachableDatabase, setupToken, { ...validInput, ...override }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an oversized setup token before accessing D1", async () => {
    await expect(
      initializeInstallation(unreachableDatabase, setupToken, {
        ...validInput,
        token: "t".repeat(513),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
