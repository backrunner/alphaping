import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import {
  acceptInvitationForUser,
  loadWorkspaceInvitation,
  registerFromWorkspaceInvitation,
} from "$lib/server/workspace-invitations";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  const authenticatedEmail = locals.session?.user.email ?? null;
  const invitation = await loadWorkspaceInvitation(
    platform.env.CONTROL_DB,
    params.token,
    platform.env.BETTER_AUTH_SECRET,
    Date.now(),
    authenticatedEmail,
  );
  return {
    invitation,
    invitePath: `/invite/${encodeURIComponent(params.token)}`,
    authenticated: Boolean(locals.session),
    authenticatedEmail: locals.session?.user.email ?? null,
  };
};

export const actions: Actions = {
  default: async ({ request, locals, params, platform }) => {
    if (!platform) return fail(503, { message: "Cloudflare bindings are unavailable" });
    const form = await request.formData();
    try {
      if (locals.session && form.get("intent") === "switch-account") {
        if (!locals.auth) return fail(503, { message: "Authentication is unavailable" });
        await locals.auth.api.signOut({ headers: request.headers });
        const invitePath = `/invite/${encodeURIComponent(params.token)}`;
        throw redirect(303, `/login?returnTo=${encodeURIComponent(invitePath)}`);
      }
      if (locals.session) {
        const result = await acceptInvitationForUser(
          platform.env.CONTROL_DB,
          params.token,
          platform.env.BETTER_AUTH_SECRET,
          { id: locals.session.user.id, email: locals.session.user.email },
        );
        throw redirect(303, `/${result.workspaceSlug}`);
      }
      if (!locals.auth) return fail(503, { message: "Authentication is unavailable" });
      const password = String(form.get("password") ?? "");
      const result = await registerFromWorkspaceInvitation(
        platform.env.CONTROL_DB,
        params.token,
        platform.env.BETTER_AUTH_SECRET,
        { name: String(form.get("name") ?? ""), password },
      );
      await locals.auth.api.signInEmail({
        body: { email: result.email, password },
        headers: request.headers,
      });
      throw redirect(303, `/${result.workspaceSlug}`);
    } catch (cause) {
      if (isHttpError(cause)) return fail(cause.status, { message: cause.body.message });
      throw cause;
    }
  },
};
