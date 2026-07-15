import { fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (locals.session) throw redirect(303, "/");
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.auth) return fail(503, { message: "Authentication is unavailable" });
    const form = await request.formData();
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
    throw redirect(303, "/");
  },
};
