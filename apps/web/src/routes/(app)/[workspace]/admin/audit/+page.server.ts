import { error, redirect } from "@sveltejs/kit";

import { loadWorkspaceAuditPage } from "$lib/server/workspace-audit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  return {
    audit: await loadWorkspaceAuditPage(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
      Number(url.searchParams.get("page") ?? 1),
    ),
  };
};
