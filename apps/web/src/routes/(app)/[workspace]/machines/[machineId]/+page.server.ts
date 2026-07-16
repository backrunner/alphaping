import { loadMachineDetail, MachineNotFoundError } from "@alphaping/db";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import { queueAgentCommand } from "$lib/server/agent-commands";

import type { Actions, PageServerLoad } from "./$types";

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

async function commandAction(
  event: Parameters<Actions[string]>[0],
  type: "check_update" | "install_version" | "redetect_runtimes",
) {
  if (!event.locals.session || !event.platform) return fail(401, { message: "Unauthorized" });
  const form = await event.request.formData();
  try {
    await queueAgentCommand(
      event.platform.env.CONTROL_DB,
      event.params.workspace,
      event.locals.session.user.id,
      event.params.machineId,
      {
        type,
        version: String(form.get("version") ?? ""),
        bypassRollout: form.get("bypassRollout") === "on",
      },
    );
  } catch (cause) {
    const message = isHttpError(cause) ? cause.body.message : "Agent command failed";
    return fail(isHttpError(cause) ? cause.status : 400, { command: type, message });
  }
  throw redirect(303, `/${event.params.workspace}/machines/${event.params.machineId}`);
}

export const actions: Actions = {
  checkUpdate: (event) => commandAction(event, "check_update"),
  installVersion: (event) => commandAction(event, "install_version"),
  redetectRuntimes: (event) => commandAction(event, "redetect_runtimes"),
};
