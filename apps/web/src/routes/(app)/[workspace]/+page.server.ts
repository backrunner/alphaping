import { env } from "cloudflare:workers";
import { DashboardNotFoundError, loadDashboardSnapshot } from "@alphaping/db";
import { error, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!env.CONTROL_DB) throw error(503, "Cloudflare bindings are unavailable");
  try {
    return await loadDashboardSnapshot(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
    );
  } catch (cause) {
    if (cause instanceof DashboardNotFoundError) throw error(404, "Workspace not found");
    throw cause;
  }
};

export const actions: Actions = {
  logout: async ({ request, locals }) => {
    if (locals.auth) {
      await locals.auth.api.signOut({ headers: request.headers });
    }
    throw redirect(303, "/login");
  },
};
