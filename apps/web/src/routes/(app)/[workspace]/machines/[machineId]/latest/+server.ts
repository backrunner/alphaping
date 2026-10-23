import { env } from "cloudflare:workers";
import { loadMachineCurrent, MachineNotFoundError } from "@alphaping/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.session || !env.CONTROL_DB) return json({ message: "Not found" }, { status: 404 });
  try {
    const current = await loadMachineCurrent(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.machineId,
    );
    const tag = `"machine-${current.latest.observedAt ?? 0}-${current.latestReceivedAt ?? 0}"`;
    if (request.headers.get("if-none-match") === tag) {
      return new Response(null, {
        status: 304,
        headers: { etag: tag, "cache-control": "private, no-store" },
      });
    }
    return json(current, {
      headers: { etag: tag, "cache-control": "private, no-store" },
    });
  } catch (cause) {
    if (cause instanceof MachineNotFoundError) {
      return json({ message: "Not found" }, { status: 404 });
    }
    throw cause;
  }
};
