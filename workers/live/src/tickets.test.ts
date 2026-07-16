import { describe, expect, it } from "vitest";

import { signViewerLiveTicket, verifyLiveTicket } from "@alphaping/contracts";

describe("live tickets", () => {
  it("accepts a valid short-lived HMAC ticket", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const { ticket } = await signViewerLiveTicket(
      { workspaceId: "workspace-1", subjectId: "viewer-1", machinePk: 1 },
      secret,
      1_000,
    );

    await expect(verifyLiveTicket(ticket, secret, 1_000)).resolves.toMatchObject({
      workspaceId: "workspace-1",
      role: "viewer",
    });
  });

  it("rejects cross-role edits, expiry, and invalid machine topics", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const { ticket, expiresAt } = await signViewerLiveTicket(
      { workspaceId: "workspace-1", subjectId: "viewer-1", machinePk: 7 },
      secret,
      10_000,
    );
    await expect(verifyLiveTicket(ticket, secret, expiresAt)).rejects.toThrow("invalid_ticket");
    await expect(
      signViewerLiveTicket(
        { workspaceId: "workspace-1", subjectId: "viewer-1", machinePk: 0 },
        secret,
      ),
    ).rejects.toThrow("invalid_machine_scope");
    const changed = `${ticket.slice(0, -1)}${ticket.endsWith("A") ? "B" : "A"}`;
    await expect(verifyLiveTicket(changed, secret, 10_000)).rejects.toThrow("invalid_ticket");
  });
});
