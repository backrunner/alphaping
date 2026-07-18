import { fail, redirect } from "@sveltejs/kit";

import { allowCredentialAttempt } from "$lib/server/auth-rate-limit";
import { safeLocalPath } from "$lib/server/workspace-admin";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url }) => {
  const returnTo = safeLocalPath(url.searchParams.get("returnTo"));
  if (locals.session) throw redirect(303, returnTo);
  return { returnTo };
};

export const actions: Actions = {
  default: async ({ request, locals, platform }) => {
    if (!locals.auth || !platform) return fail(503, { message: "Authentication is unavailable" });
    const form = await request.formData();
    const returnTo = safeLocalPath(String(form.get("returnTo") ?? ""));
    const email = String(form.get("email") ?? "");
    if (
      !(await allowCredentialAttempt(
        platform.env.AUTH_EDGE_RATE_LIMITER,
        platform.env.AUTH_ACCOUNT_RATE_LIMITER,
        request.headers,
        email,
      ))
    ) {
      return fail(429, { message: "Too many sign-in attempts. Try again later." });
    }
    try {
      await locals.auth.api.signInEmail({
        body: {
          email,
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
