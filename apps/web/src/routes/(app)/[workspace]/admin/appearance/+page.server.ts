import { error, fail, isHttpError, redirect } from "@sveltejs/kit";
import { loadSiteAppearance, updateSiteAppearance } from "$lib/server/site-appearance";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  return {
    appearance: await loadSiteAppearance(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
    ),
  };
};
export const actions: Actions = {
  default: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { message: "Sign in to save appearance settings" });
    const form = await request.formData();
    try {
      await updateSiteAppearance(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          title: form.get("title"),
          description: form.get("description"),
          logoUrl: form.get("logoUrl"),
          palette: form.get("palette"),
          mode: form.get("mode"),
          density: form.get("density"),
        },
      );
      return { saved: true };
    } catch (cause) {
      return fail(isHttpError(cause) ? cause.status : 500, {
        message: isHttpError(cause)
          ? cause.body.message
          : "Appearance could not be saved. Please try again.",
      });
    }
  },
};
