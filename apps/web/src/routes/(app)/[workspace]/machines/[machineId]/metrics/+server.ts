import { loadMachineHistory, MachineHistoryRangeError, MachineNotFoundError } from "@alphaping/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params, platform, url }) => {
  if (!locals.session || !platform) return json({ message: "Not found" }, { status: 404 });
  const resolution = url.searchParams.get("resolution");
  if (resolution !== "5m" && resolution !== "1h") {
    return json({ message: "Resolution is invalid" }, { status: 400 });
  }
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  try {
    const points = await loadMachineHistory(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.machineId,
      resolution,
      from,
      to,
    );
    return json({ resolution, points }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof MachineNotFoundError) {
      return json({ message: "Not found" }, { status: 404 });
    }
    if (cause instanceof MachineHistoryRangeError) {
      return json({ message: "Time range is invalid" }, { status: 400 });
    }
    throw cause;
  }
};
