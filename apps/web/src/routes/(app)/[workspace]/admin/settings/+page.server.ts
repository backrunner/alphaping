import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import {
  loadWorkspaceSettingsPanel,
  updateDashboardVisibility,
  updateResourcePublicPolicy,
  updateRetentionSettings,
  type DashboardVisibility,
  type ProjectionProfile,
} from "$lib/server/workspace-settings";
import { softDeleteWorkspace } from "$lib/server/workspace-lifecycle";

import type { Actions, PageServerLoad } from "./$types";

function settingsFailure(cause: unknown, kind: string) {
  const status = isHttpError(cause) ? cause.status : 400;
  const message = isHttpError(cause) ? cause.body.message : "The setting could not be saved";
  return fail(status, { kind, message });
}

export const load: PageServerLoad = async ({ locals, params, platform, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  return {
    workspace: params.workspace,
    settings: await loadWorkspaceSettingsPanel(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
      {
        resourceCursor: url.searchParams.get("resourceCursor"),
        resourceDirection:
          url.searchParams.get("resourceDirection") === "before" ? "before" : "after",
      },
    ),
  };
};

export const actions: Actions = {
  visibility: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "visibility", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await updateDashboardVisibility(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        String(form.get("visibility")) as DashboardVisibility,
      );
      return { kind: "visibility", updated: true };
    } catch (cause) {
      return settingsFailure(cause, "visibility");
    }
  },
  publicResource: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "publicResource", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await updateResourcePublicPolicy(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          resourceType: String(form.get("resourceType")) as "machine" | "service" | "container",
          resourceId: String(form.get("resourceId") ?? ""),
          effect: String(form.get("effect")) as "allow" | "deny",
          projectionProfile: String(form.get("projectionProfile")) as ProjectionProfile,
        },
      );
      return { kind: "publicResource", updated: true };
    } catch (cause) {
      return settingsFailure(cause, "publicResource");
    }
  },
  retention: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "retention", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await updateRetentionSettings(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          rawDays: Number(form.get("rawDays")),
          rollup5mDays: Number(form.get("rollup5mDays")),
          rollup1hDays: Number(form.get("rollup1hDays")),
          eventDays: Number(form.get("eventDays")),
          auditLogDays: Number(form.get("auditLogDays")),
          expiredAnnouncementGraceDays: Number(form.get("expiredAnnouncementGraceDays")),
          softDeleteGraceDays: Number(form.get("softDeleteGraceDays")),
        },
      );
      return { kind: "retention", updated: true };
    } catch (cause) {
      return settingsFailure(cause, "retention");
    }
  },
  deleteWorkspace: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "workspaceDelete", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await softDeleteWorkspace(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        String(form.get("confirmation") ?? ""),
      );
    } catch (cause) {
      return settingsFailure(cause, "workspaceDelete");
    }
    throw redirect(303, "/workspaces");
  },
};
