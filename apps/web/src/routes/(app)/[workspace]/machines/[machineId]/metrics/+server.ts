import { env } from "cloudflare:workers";
import {
  loadMachineHistory,
  MachineHistoryDataError,
  MachineHistoryRangeError,
  MachineNotFoundError,
} from "@alphaping/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.session || !env.CONTROL_DB) return json({ message: "Not found" }, { status: 404 });
  const resolution = url.searchParams.get("resolution");
  if (resolution !== "raw" && resolution !== "5m" && resolution !== "1h") {
    return json({ message: "Resolution is invalid" }, { status: 400 });
  }
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  try {
    const page = await loadMachineHistory(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.machineId,
      resolution,
      from,
      to,
      url.searchParams.get("cursor"),
    );
    return json({ resolution, ...page }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof MachineNotFoundError) {
      return json({ message: "Not found" }, { status: 404 });
    }
    if (cause instanceof MachineHistoryRangeError) {
      return json({ message: "Time range or cursor is invalid" }, { status: 400 });
    }
    if (cause instanceof MachineHistoryDataError) {
      return json({ message: "History data is unavailable" }, { status: 502 });
    }
    throw cause;
  }
};
