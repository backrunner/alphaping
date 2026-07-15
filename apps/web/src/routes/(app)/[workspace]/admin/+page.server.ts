import { fail, isHttpError, redirect } from "@sveltejs/kit";

import { createHttpService, createMachine } from "$lib/server/resources";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) return { workspace: params.workspace, ingestOrigin: "" };
  const membership = await platform.env.CONTROL_DB.prepare(
    `SELECT m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
     WHERE w.slug = ? AND m.user_id = ? AND m.status = 'active'`,
  )
    .bind(params.workspace, locals.session.user.id)
    .first<{ role: string }>();
  if (membership?.role !== "admin") throw redirect(303, `/${params.workspace}`);
  return { workspace: params.workspace, ingestOrigin: platform.env.INGEST_ORIGIN };
};

export const actions: Actions = {
  machine: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "machine", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const machine = await createMachine(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          name: String(form.get("name") ?? "").trim(),
          expectedHost: String(form.get("expectedHost") ?? "").trim(),
          containersEnabled: form.get("containersEnabled") === "on",
        },
      );
      return { kind: "machine", machine };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Machine creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "machine", message });
    }
  },
  service: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "service", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await createHttpService(platform.env.CONTROL_DB, params.workspace, locals.session.user.id, {
        name: String(form.get("name") ?? "").trim(),
        url: String(form.get("url") ?? "").trim(),
        intervalSeconds: Number(form.get("intervalSeconds")),
        expectedStatus: Number(form.get("expectedStatus")),
      });
      return { kind: "service", created: true };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Service creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "service", message });
    }
  },
};
