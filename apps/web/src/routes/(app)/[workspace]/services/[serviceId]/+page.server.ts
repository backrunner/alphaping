import { loadServiceDetail, ServiceNotFoundError } from "@alphaping/db";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import { setServicePublicAccess } from "$lib/server/service-config";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    return await loadServiceDetail(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      locals.session.user.id,
      params.serviceId,
    );
  } catch (cause) {
    if (cause instanceof ServiceNotFoundError) throw error(404, "Service not found");
    throw cause;
  }
};

export const actions: Actions = {
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
