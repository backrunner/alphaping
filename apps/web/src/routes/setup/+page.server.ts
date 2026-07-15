import { fail, isHttpError, redirect } from "@sveltejs/kit";

import { initializeInstallation } from "$lib/server/setup";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ platform }) => {
  if (!platform) return { installed: false };
  const installation = await platform.env.CONTROL_DB.prepare(
    "SELECT 1 AS installed FROM installations WHERE state = 'complete' LIMIT 1",
  ).first<{ installed: number }>();
  return { installed: Boolean(installation) };
};

export const actions: Actions = {
  default: async ({ request, platform }) => {
    if (!platform) return fail(503, { message: "Cloudflare bindings are unavailable" });
    const form = await request.formData();
    const rawDays = Number(form.get("rawDays"));
    let result: { workspaceSlug: string };
    try {
      result = await initializeInstallation(platform.env.CONTROL_DB, platform.env.SETUP_TOKEN, {
        token: String(form.get("token") ?? ""),
        name: String(form.get("name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        workspaceName: String(form.get("workspaceName") ?? "").trim(),
        workspaceSlug: String(form.get("workspaceSlug") ?? "").trim(),
        rawDays,
      });
    } catch (cause) {
      if (isHttpError(cause)) return fail(cause.status, { message: cause.body.message });
      const message = cause instanceof Error ? cause.message : "Initialization failed";
      return fail(400, { message });
    }
    throw redirect(303, `/login?workspace=${result.workspaceSlug}`);
  },
};
