import { error, fail, isHttpError, isRedirect, redirect } from "@sveltejs/kit";

import { listUserWorkspaces, restoreWorkspace } from "$lib/server/workspace-lifecycle";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.session) throw redirect(303, "/login?returnTo=%2Fworkspaces");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  return {
    now: Date.now(),
    workspaces: await listUserWorkspaces(platform.env.CONTROL_DB, locals.session.user.id),
  };
};

export const actions: Actions = {
  restore: async ({ request, locals, platform }) => {
    if (!locals.session || !platform) return fail(401, { message: "Unauthorized" });
    const form = await request.formData();
    try {
      const restored = await restoreWorkspace(
        platform.env.CONTROL_DB,
        String(form.get("workspaceId") ?? ""),
        locals.session.user.id,
      );
      throw redirect(303, `/${restored.slug}`);
    } catch (cause) {
      if (isRedirect(cause)) throw cause;
      const message = isHttpError(cause) ? cause.body.message : "Workspace restoration failed";
      return fail(isHttpError(cause) ? cause.status : 400, { message });
    }
  },
  logout: async ({ request, locals }) => {
    if (locals.auth) await locals.auth.api.signOut({ headers: request.headers });
    throw redirect(303, "/login");
  },
};
