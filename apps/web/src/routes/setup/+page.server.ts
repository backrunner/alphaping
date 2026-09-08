import { fail, isHttpError, redirect } from "@sveltejs/kit";

import { initializeInstallation } from "$lib/server/setup";
import {
  inspectSetupEnvironment,
  unavailableSetupEnvironment,
} from "$lib/server/setup-environment";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ platform }) => {
  if (!platform)
    return {
      installed: false,
      workspaceSlug: null,
      environment: unavailableSetupEnvironment(),
    };
  const installation = await platform.env.CONTROL_DB.prepare(
    "SELECT 1 AS installed FROM installations WHERE state = 'complete' LIMIT 1",
  )
    .first<{ installed: number }>()
    .catch(() => null);
  const installed = Boolean(installation);
  const workspace = installed
    ? await platform.env.CONTROL_DB.prepare(
        "SELECT slug FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1",
      ).first<{ slug: string }>()
    : null;
  return {
    installed,
    workspaceSlug: workspace?.slug ?? null,
    environment: installed ? null : await inspectSetupEnvironment(platform.env),
  };
};

export const actions: Actions = {
  default: async ({ request, platform }) => {
    if (!platform)
      return fail(503, {
        message: "Cloudflare bindings are unavailable",
        step: 1,
      });
    const environment = await inspectSetupEnvironment(platform.env);
    if (!environment.ready) {
      return fail(503, {
        message: "Resolve the environment checks before initialization",
        step: 1,
      });
    }
    const form = await request.formData();
    const rawDays = Number(form.get("rawDays"));
    try {
      await initializeInstallation(platform.env.CONTROL_DB, platform.env.SETUP_TOKEN, {
        token: String(form.get("token") ?? ""),
        name: String(form.get("name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        workspaceName: String(form.get("workspaceName") ?? "").trim(),
        workspaceSlug: String(form.get("workspaceSlug") ?? "").trim(),
        rawDays,
        defaultSamplingIntervalSeconds: Number(form.get("defaultSamplingIntervalSeconds")),
        dashboardVisibility: String(form.get("dashboardVisibility")) as
          "private" | "authenticated" | "public",
      });
    } catch (cause) {
      if (isHttpError(cause)) {
        return fail(cause.status, {
          message: cause.body.message,
          step: cause.status === 403 ? 2 : 5,
        });
      }
      return fail(500, { message: "Initialization failed", step: 5 });
    }
    throw redirect(303, "/setup");
  },
};
