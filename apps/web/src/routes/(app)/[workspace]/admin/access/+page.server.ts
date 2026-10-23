import { env } from "cloudflare:workers";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import {
  loadWorkspaceAccessPanel,
  setMemberResourcePermission,
  updateWorkspaceMembership,
  type ResourcePermission,
} from "#lib/server/workspace-access.ts";
import {
  createWorkspaceInvitation,
  revokeWorkspaceInvitation,
} from "#lib/server/workspace-invitations.ts";

import type { Actions, PageServerLoad } from "./$types";

function actionFailure(cause: unknown, kind: string) {
  const status = isHttpError(cause) ? cause.status : 400;
  const message = isHttpError(cause) ? cause.body.message : "The access change could not be saved";
  return fail(status, { kind, message });
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!env.CONTROL_DB) throw error(503, "Cloudflare bindings are unavailable");
  return {
    workspace: params.workspace,
    access: await loadWorkspaceAccessPanel(
      env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
      {
        memberId: url.searchParams.get("member"),
        memberPage: Number(url.searchParams.get("memberPage") ?? "1"),
        invitationPage: Number(url.searchParams.get("invitationPage") ?? "1"),
        resourcePage: Number(url.searchParams.get("resourcePage") ?? "1"),
      },
    ),
  };
};

export const actions: Actions = {
  invite: async ({ request, locals, params, url }) => {
    if (!locals.session || !env.CONTROL_DB)
      return fail(401, { kind: "invite", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const invitation = await createWorkspaceInvitation(
        env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        env.BETTER_AUTH_SECRET,
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
  revokeInvite: async ({ request, locals, params }) => {
    if (!locals.session || !env.CONTROL_DB)
      return fail(401, { kind: "revoke", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await revokeWorkspaceInvitation(
        env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        String(form.get("invitationId") ?? ""),
      );
      return { kind: "revoke", updated: true };
    } catch (cause) {
      return actionFailure(cause, "revoke");
    }
  },
  membership: async ({ request, locals, params }) => {
    if (!locals.session || !env.CONTROL_DB)
      return fail(401, { kind: "membership", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await updateWorkspaceMembership(env.CONTROL_DB, params.workspace, locals.session.user.id, {
        memberId: String(form.get("memberId") ?? ""),
        role: String(form.get("role") ?? "member") as "admin" | "member",
        status: String(form.get("status") ?? "active") as "active" | "suspended",
      });
      return { kind: "membership", updated: true };
    } catch (cause) {
      return actionFailure(cause, "membership");
    }
  },
  grant: async ({ request, locals, params }) => {
    if (!locals.session || !env.CONTROL_DB)
      return fail(401, { kind: "grant", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await setMemberResourcePermission(env.CONTROL_DB, params.workspace, locals.session.user.id, {
        memberId: String(form.get("memberId") ?? ""),
        resourceType: String(form.get("resourceType")) as "machine" | "service" | "container",
        resourceId: String(form.get("resourceId") ?? ""),
        permission: String(form.get("permission") ?? "none") as ResourcePermission,
      });
      return { kind: "grant", updated: true };
    } catch (cause) {
      return actionFailure(cause, "grant");
    }
  },
};
