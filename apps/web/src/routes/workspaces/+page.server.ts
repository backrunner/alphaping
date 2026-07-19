import { error, fail, isHttpError, isRedirect, redirect } from "@sveltejs/kit";

import {
  createWorkspace,
  listUserWorkspacePage,
  restoreWorkspace,
} from "$lib/server/workspace-lifecycle";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.session) throw redirect(303, "/login?returnTo=%2Fworkspaces");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  return {
    now: Date.now(),
    workspaces: await listUserWorkspacePage(platform.env.CONTROL_DB, locals.session.user.id, {
      page: Number(url.searchParams.get("page") ?? "1"),
    }),
  };
};

export const actions: Actions = {
  create: async ({ request, locals, platform }) => {
    if (!locals.session || !platform) return fail(401, { kind: "create", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const workspace = await createWorkspace(platform.env.CONTROL_DB, locals.session.user.id, {
        name: String(form.get("name") ?? ""),
        slug: String(form.get("slug") ?? ""),
        rawDays: Number(form.get("rawDays")),
        defaultSamplingIntervalSeconds: Number(form.get("defaultSamplingIntervalSeconds")),
        dashboardVisibility: String(form.get("dashboardVisibility")) as
          | "private"
          | "authenticated"
          | "public",
      });
      throw redirect(303, `/${workspace.slug}`);
    } catch (cause) {
      if (isRedirect(cause)) throw cause;
      const message = isHttpError(cause) ? cause.body.message : "Workspace creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, {
        kind: "create",
        message,
      });
    }
  },
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
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "restore", message });
    }
  },
  logout: async ({ request, locals }) => {
    if (locals.auth) await locals.auth.api.signOut({ headers: request.headers });
    throw redirect(303, "/login");
  },
};
