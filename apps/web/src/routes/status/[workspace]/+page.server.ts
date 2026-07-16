import { loadPublicStatusPage, PublicStatusNotFoundError } from "@alphaping/db";
import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, platform, setHeaders }) => {
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    const page = await loadPublicStatusPage(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
    );
    setHeaders({
      "cache-control": "public, max-age=30, stale-while-revalidate=300",
      "x-robots-tag": "noindex",
    });
    return page;
  } catch (cause) {
    if (cause instanceof PublicStatusNotFoundError) throw error(404, "Status page not found");
    throw cause;
  }
};
