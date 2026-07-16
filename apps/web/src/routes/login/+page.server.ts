import { fail, redirect } from "@sveltejs/kit";

import { safeLocalPath } from "$lib/server/workspace-admin";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url }) => {
  const returnTo = safeLocalPath(url.searchParams.get("returnTo"));
  if (locals.session) throw redirect(303, returnTo);
  return { returnTo };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.auth) return fail(503, { message: "Authentication is unavailable" });
    const form = await request.formData();
    const returnTo = safeLocalPath(String(form.get("returnTo") ?? ""));
    try {
      await locals.auth.api.signInEmail({
        body: {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        },
        headers: request.headers,
      });
    } catch {
      return fail(400, { message: "Email or password is incorrect" });
    }
    throw redirect(303, returnTo);
  },
};
