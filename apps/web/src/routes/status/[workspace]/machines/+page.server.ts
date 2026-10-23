import { env } from "cloudflare:workers";
import { loadPublicMachinesStatusPage, PublicStatusNotFoundError } from "@alphaping/db";
import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  if (!env.CONTROL_DB) throw error(503, "Cloudflare bindings are unavailable");
  try {
    const page = await loadPublicMachinesStatusPage(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      params.workspace,
    );
    setHeaders({
      "cache-control": "public, max-age=30, must-revalidate",
      "x-alphaping-status-source": "live",
      "x-robots-tag": "noindex",
    });
    return page;
  } catch (cause) {
    if (cause instanceof PublicStatusNotFoundError) throw error(404, "Status page not found");
    throw cause;
  }
};
