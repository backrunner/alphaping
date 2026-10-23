import { env } from "cloudflare:workers";
import {
  loadPublicServiceStatusPage,
  PublicStatusDataError,
  PublicStatusNotFoundError,
} from "@alphaping/db";
import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  if (!env.CONTROL_DB) throw error(503, "Cloudflare bindings are unavailable");
  try {
    const page = await loadPublicServiceStatusPage(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      params.workspace,
      params.serviceSlug,
    );
    setHeaders({
      "cache-control": "public, max-age=30, must-revalidate",
      "x-robots-tag": "noindex",
    });
    return page;
  } catch (cause) {
    if (cause instanceof PublicStatusNotFoundError) throw error(404, "Service status not found");
    if (cause instanceof PublicStatusDataError) throw error(503, "Service status is unavailable");
    throw cause;
  }
};
