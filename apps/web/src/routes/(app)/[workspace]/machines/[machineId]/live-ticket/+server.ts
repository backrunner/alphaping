import { signViewerLiveTicket } from "@alphaping/contracts";
import { loadAuthorizedMachineScope, MachineNotFoundError } from "@alphaping/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

function liveOrigin(value: string): string | null {
  if (value.length > 256) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "wss:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return null;
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export const GET: RequestHandler = async ({ locals, params, platform }) => {
  if (!locals.session || !platform) return json({ message: "Not found" }, { status: 404 });
  try {
    const scope = await loadAuthorizedMachineScope(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
      params.machineId,
    );
    const origin = liveOrigin(platform.env.LIVE_ORIGIN);
    if (!origin) {
      return json(
        { available: false },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const signed = await signViewerLiveTicket(
      {
        workspaceId: scope.workspaceId,
        subjectId: locals.session.user.id,
        machinePk: scope.machinePk,
      },
      platform.env.LIVE_TICKET_SECRET,
    );
    return json(
      {
        available: true,
        url: `${origin}/v1/live/${encodeURIComponent(scope.workspaceId)}`,
        ticket: signed.ticket,
        topic: `machine:${scope.machinePk}`,
        expiresAt: signed.expiresAt,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (cause) {
    if (cause instanceof MachineNotFoundError) {
      return json({ message: "Not found" }, { status: 404 });
    }
    return json({ available: false }, { headers: { "cache-control": "private, no-store" } });
  }
};
