import { loadMachineDetail, MachineNotFoundError } from "@alphaping/db";
import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    return await loadMachineDetail(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.machineId,
    );
  } catch (cause) {
    if (cause instanceof MachineNotFoundError) throw error(404, "Machine not found");
    throw cause;
  }
};
