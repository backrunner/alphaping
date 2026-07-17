import { loadMachineDetail, MachineNotFoundError } from "@alphaping/db";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import { queueAgentCommand } from "$lib/server/agent-commands";
import { updateMachineConfiguration } from "$lib/server/resources";

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
  updateConfig: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "machineConfig", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const maintenanceValue = String(form.get("maintenanceUntil") ?? "");
      const timezoneOffsetMinutes = Number(form.get("timezoneOffsetMinutes"));
      let maintenanceUntil: number | null = null;
      if (maintenanceValue) {
        if (!Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) {
          throw error(400, "Timezone offset is invalid");
        }
        const localWallClock = Date.parse(`${maintenanceValue}:00Z`);
        if (!Number.isFinite(localWallClock)) throw error(400, "Maintenance end time is invalid");
        maintenanceUntil = localWallClock + timezoneOffsetMinutes * 60_000;
      }
      const updated = await updateMachineConfiguration(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        params.machineId,
        {
          name: String(form.get("name") ?? ""),
          expectedHost: String(form.get("expectedHost") ?? ""),
          description: String(form.get("description") ?? ""),
          labels: String(form.get("labels") ?? ""),
          samplingIntervalSeconds: Number(form.get("samplingIntervalSeconds")),
          reportIntervalSeconds: Number(form.get("reportIntervalSeconds")),
          offlineAfterSeconds: Number(form.get("offlineAfterSeconds")),
          containersEnabled: form.get("containersEnabled") === "on",
          maintenanceUntil,
        },
      );
      return { kind: "machineConfig", saved: true, revision: updated.revision };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Machine configuration failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "machineConfig", message });
    }
  },
  checkUpdate: (event) => commandAction(event, "check_update"),
  installVersion: (event) => commandAction(event, "install_version"),
  redetectRuntimes: (event) => commandAction(event, "redetect_runtimes"),
};
