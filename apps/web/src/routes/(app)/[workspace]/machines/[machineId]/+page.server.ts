import { loadMachineDetail, MachineNotFoundError } from "@alphaping/db";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import { queueAgentCommand } from "$lib/server/agent-commands";
import { installerChecksums } from "$lib/server/installers";
import {
  listMachineEnrollmentTokens,
  regenerateMachineEnrollmentToken,
  revokeMachineEnrollmentToken,
  softDeleteResource,
  updateMachineConfiguration,
} from "$lib/server/resources";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    const detail = await loadMachineDetail(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.machineId,
    );
    const canAdministerAgent = detail.workspace.role === "admin";
    const [enrollmentTokens, checksums] = canAdministerAgent
      ? await Promise.all([
          listMachineEnrollmentTokens(
            platform.env.CONTROL_DB,
            params.workspace,
            locals.session.user.id,
            params.machineId,
          ),
          installerChecksums(),
        ])
      : [[], { unix: "", windows: "" }];
    return {
      ...detail,
      canAdministerAgent,
      enrollmentTokens,
      installerChecksums: checksums,
      ingestOrigin: platform.env.INGEST_ORIGIN,
      installOrigin: url.origin,
      requestedTab: url.searchParams.get("tab"),
    };
  } catch (cause) {
    if (cause instanceof MachineNotFoundError) throw error(404, "Machine not found");
    throw cause;
  }
};

async function commandAction(
  event: Parameters<Actions[string]>[0],
  type: "check_update" | "install_version" | "redetect_runtimes",
) {
  if (!event.locals.session || !event.platform) {
    return fail(401, { command: type, message: "Unauthorized" });
  }
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
  throw redirect(303, `/${event.params.workspace}/machines/${event.params.machineId}?tab=config`);
}

export const actions: Actions = {
  delete: async ({ locals, params, platform }) => {
    if (!locals.session || !platform) {
      return fail(401, { kind: "delete", message: "Unauthorized" });
    }
    try {
      await softDeleteResource(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        "machine",
        params.machineId,
      );
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Machine deletion failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "delete", message });
    }
    throw redirect(303, `/${params.workspace}/machines`);
  },
  regenerateEnrollment: async ({ locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "enrollment", message: "Unauthorized" });
    try {
      const enrollment = await regenerateMachineEnrollmentToken(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        platform.env.ENROLLMENT_TOKEN_PEPPER,
        params.machineId,
      );
      return { kind: "enrollment", enrollment };
    } catch (cause) {
      const message = isHttpError(cause)
        ? cause.body.message
        : "Enrollment token generation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "enrollment", message });
    }
  },
  revokeEnrollment: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "enrollment", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await revokeMachineEnrollmentToken(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        params.machineId,
        String(form.get("tokenId") ?? ""),
      );
      return { kind: "enrollment", revoked: true };
    } catch (cause) {
      const message = isHttpError(cause)
        ? cause.body.message
        : "Enrollment token revocation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "enrollment", message });
    }
  },
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
