import { loadServiceDetail, ServiceNotFoundError } from "@alphaping/db";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import {
  addServiceCheck,
  deleteServiceCheck,
  listServiceCheckAgents,
  setServiceMaintenance,
  setServicePublicAccess,
  updateServiceCheckPolicy,
} from "$lib/server/service-config";
import { parseServiceCheckForm } from "$lib/server/service-form";
import { softDeleteResource } from "$lib/server/resources";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    const detail = await loadServiceDetail(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.serviceId,
    );
    return {
      ...detail,
      checkAgents: detail.service.canManage
        ? await listServiceCheckAgents(
            platform.env.CONTROL_DB,
            params.workspace,
            locals.session.user.id,
            params.serviceId,
          )
        : [],
    };
  } catch (cause) {
    if (cause instanceof ServiceNotFoundError) throw error(404, "Service not found");
    throw cause;
  }
};

export const actions: Actions = {
  addCheck: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "serviceCheck", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const result = await addServiceCheck(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        platform.env.CHECK_SECRET_WRAPPING_KEY,
        params.serviceId,
        {
          checkName: String(form.get("checkName") ?? "").trim(),
          ...parseServiceCheckForm(form),
        },
      );
      return { kind: "serviceCheck", created: true, checkId: result.checkId };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Check creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "serviceCheck", message });
    }
  },
  updateCheckPolicy: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "checkPolicy", message: "Unauthorized" });
    const form = await request.formData();
    const checkId = String(form.get("checkId") ?? "");
    try {
      await updateServiceCheckPolicy(
        platform.env.CONTROL_DB,
        platform.env.TELEMETRY_DB,
        params.workspace,
        locals.session.user.id,
        params.serviceId,
        checkId,
        {
          enabled: form.get("enabled") === "on",
          intervalSeconds: Number(form.get("intervalSeconds")),
          timeoutMs: Number(form.get("timeoutMs")),
          retryCount: Number(form.get("retryCount")),
          failureConfirmations: Number(form.get("failureConfirmations")),
          recoveryConfirmations: Number(form.get("recoveryConfirmations")),
          critical: form.get("critical") === "on",
        },
      );
      return { kind: "checkPolicy", saved: true, checkId };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Check policy update failed";
      return fail(isHttpError(cause) ? cause.status : 400, {
        kind: "checkPolicy",
        checkId,
        message,
      });
    }
  },
  deleteCheck: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "checkPolicy", message: "Unauthorized" });
    const form = await request.formData();
    const checkId = String(form.get("checkId") ?? "");
    try {
      await deleteServiceCheck(
        platform.env.CONTROL_DB,
        platform.env.TELEMETRY_DB,
        params.workspace,
        locals.session.user.id,
        params.serviceId,
        checkId,
      );
      return { kind: "checkPolicy", deleted: true, checkId };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Check deletion failed";
      return fail(isHttpError(cause) ? cause.status : 400, {
        kind: "checkPolicy",
        checkId,
        message,
      });
    }
  },
  delete: async ({ locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { message: "Unauthorized" });
    try {
      await softDeleteResource(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        "service",
        params.serviceId,
      );
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Service deletion failed";
      return fail(isHttpError(cause) ? cause.status : 400, { message });
    }
    throw redirect(303, `/${params.workspace}/services`);
  },
  maintenance: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { message: "Unauthorized" });
    const form = await request.formData();
    try {
      const value = String(form.get("maintenanceUntil") ?? "");
      const timezoneOffsetMinutes = Number(form.get("timezoneOffsetMinutes"));
      let maintenanceUntil: number | null = null;
      if (value) {
        if (!Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) {
          throw error(400, "Timezone offset is invalid");
        }
        const localWallClock = Date.parse(`${value}:00Z`);
        if (!Number.isFinite(localWallClock)) throw error(400, "Maintenance end time is invalid");
        maintenanceUntil = localWallClock + timezoneOffsetMinutes * 60_000;
      }
      await setServiceMaintenance(
        platform.env.CONTROL_DB,
        platform.env.TELEMETRY_DB,
        params.workspace,
        locals.session.user.id,
        params.serviceId,
        maintenanceUntil,
      );
      return { maintenanceUpdated: true };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Maintenance update failed";
      return fail(isHttpError(cause) ? cause.status : 400, { message });
    }
  },
  visibility: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { message: "Unauthorized" });
    const form = await request.formData();
    try {
      await setServicePublicAccess(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        params.serviceId,
        form.get("visibility") === "public",
      );
      return { updated: true };
    } catch (cause) {
      if (isHttpError(cause)) return fail(cause.status, { message: cause.body.message });
      return fail(400, { message: "Visibility update failed" });
    }
  },
};
