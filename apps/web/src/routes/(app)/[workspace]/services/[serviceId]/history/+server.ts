import {
  loadServiceHistory,
  ServiceHistoryDataError,
  ServiceHistoryRangeError,
  ServiceNotFoundError,
} from "@alphaping/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params, platform, url }) => {
  if (!locals.session || !platform) return json({ message: "Not found" }, { status: 404 });
  const resolution = url.searchParams.get("resolution");
  if (resolution !== "5m" && resolution !== "1h") {
    return json({ message: "Resolution is invalid" }, { status: 400 });
  }
  try {
    const page = await loadServiceHistory(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.serviceId,
      resolution,
      Number(url.searchParams.get("from")),
      Number(url.searchParams.get("to")),
      url.searchParams.get("cursor"),
    );
    return json({ resolution, ...page }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof ServiceNotFoundError) {
      return json({ message: "Not found" }, { status: 404 });
    }
    if (cause instanceof ServiceHistoryRangeError) {
      return json({ message: "Time range or cursor is invalid" }, { status: 400 });
    }
    if (cause instanceof ServiceHistoryDataError) {
      return json({ message: "History data is unavailable" }, { status: 502 });
    }
    throw cause;
  }
};
