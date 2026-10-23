import { env } from "cloudflare:workers";
import { error, redirect } from "@sveltejs/kit";

import { loadWorkspaceAuditPage } from "#lib/server/workspace-audit.ts";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!env.CONTROL_DB) throw error(503, "Cloudflare bindings are unavailable");
  return {
    audit: await loadWorkspaceAuditPage(
      env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
      Number(url.searchParams.get("page") ?? 1),
    ),
  };
};
