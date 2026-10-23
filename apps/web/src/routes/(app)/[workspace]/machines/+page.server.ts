import { env } from "cloudflare:workers";
import { loadMachineCollection, MachineNotFoundError } from "@alphaping/db";
import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!env.CONTROL_DB) throw error(503, "Cloudflare bindings are unavailable");
  try {
    return await loadMachineCollection(
      env.CONTROL_DB,
      env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
    );
  } catch (cause) {
    if (cause instanceof MachineNotFoundError) throw error(404, "Workspace not found");
    throw cause;
  }
};
