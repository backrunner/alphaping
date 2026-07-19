import { loadPublicMachineStatusPage, PublicStatusNotFoundError } from "@alphaping/db";
import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, platform, setHeaders }) => {
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    const page = await loadPublicMachineStatusPage(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      params.machineId,
    );
    setHeaders({
      "cache-control": "public, max-age=30, must-revalidate",
      "x-robots-tag": "noindex",
    });
    return page;
  } catch (cause) {
    if (cause instanceof PublicStatusNotFoundError) throw error(404, "Machine status not found");
    throw cause;
  }
};
