import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import {
  loadWorkspaceAccessPanel,
  setMemberResourcePermission,
  updateWorkspaceMembership,
  type ResourcePermission,
} from "$lib/server/workspace-access";
import {
  createWorkspaceInvitation,
  revokeWorkspaceInvitation,
} from "$lib/server/workspace-invitations";

import type { Actions, PageServerLoad } from "./$types";

function actionFailure(cause: unknown, kind: string) {
  const status = isHttpError(cause) ? cause.status : 400;
  const message = isHttpError(cause) ? cause.body.message : "The access change could not be saved";
  return fail(status, { kind, message });
}

export const load: PageServerLoad = async ({ locals, params, platform, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  return {
    workspace: params.workspace,
    access: await loadWorkspaceAccessPanel(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
      url.searchParams.get("member"),
    ),
  };
};

export const actions: Actions = {
  invite: async ({ request, locals, params, platform, url }) => {
    if (!locals.session || !platform) return fail(401, { kind: "invite", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const invitation = await createWorkspaceInvitation(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        platform.env.BETTER_AUTH_SECRET,
        {
          email: String(form.get("email") ?? ""),
          role: String(form.get("role") ?? "member") as "admin" | "member",
        },
      );
      return {
        kind: "invite",
        invitationUrl: `${url.origin}/invite/${invitation.token}`,
        invitationExpiresAt: invitation.expiresAt,
      };
    } catch (cause) {
      return actionFailure(cause, "invite");
    }
  },
  revokeInvite: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { kind: "revoke", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await revokeWorkspaceInvitation(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        String(form.get("invitationId") ?? ""),
      );
      return { kind: "revoke", updated: true };
    } catch (cause) {
      return actionFailure(cause, "revoke");
    }
  },
  membership: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "membership", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await updateWorkspaceMembership(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          memberId: String(form.get("memberId") ?? ""),
          role: String(form.get("role") ?? "member") as "admin" | "member",
          status: String(form.get("status") ?? "active") as "active" | "suspended",
        },
      );
      return { kind: "membership", updated: true };
    } catch (cause) {
      return actionFailure(cause, "membership");
    }
  },
  grant: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { kind: "grant", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await setMemberResourcePermission(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          memberId: String(form.get("memberId") ?? ""),
          resourceType: String(form.get("resourceType")) as "machine" | "service" | "container",
          resourceId: String(form.get("resourceId") ?? ""),
          permission: String(form.get("permission") ?? "none") as ResourcePermission,
        },
      );
      return { kind: "grant", updated: true };
    } catch (cause) {
      return actionFailure(cause, "grant");
    }
  },
};
