import { env } from "cloudflare:workers";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import { loadDeveloperPanel } from "#lib/server/monitoring-access.ts";
import { installerChecksums } from "#lib/server/installers.ts";
import { createMachine, listDeletedResources, restoreResource } from "#lib/server/resources.ts";
import { createServiceMonitor } from "#lib/server/service-config.ts";
import { parseServiceCheckForm } from "#lib/server/service-form.ts";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!env.CONTROL_DB) throw error(503, "Cloudflare bindings are unavailable");
  const panel = await loadDeveloperPanel(env.CONTROL_DB, params.workspace, locals.session.user.id, {
    agentPage: Number(url.searchParams.get("agentPage") ?? "1"),
  });
  return {
    workspace: params.workspace,
    ingestOrigin: env.INGEST_ORIGIN,
    installOrigin: url.origin,
    installerChecksums: await installerChecksums(),
    agents: panel.agents,
    agentPagination: panel.agentPagination,
    defaultSamplingIntervalSeconds: panel.defaultSamplingIntervalSeconds,
    deletedResources: await listDeletedResources(
      env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
    ),
  };
};

export const actions: Actions = {
  restoreResource: async ({ request, locals, params }) => {
    if (!locals.session || !env.CONTROL_DB)
      return fail(401, { kind: "restore", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const resourceType = String(form.get("resourceType"));
      if (resourceType !== "machine" && resourceType !== "service") {
        throw error(400, "Resource type is invalid");
      }
      await restoreResource(
        env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        resourceType,
        String(form.get("resourceId") ?? ""),
      );
      return { kind: "restore", restored: true };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Resource restore failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "restore", message });
    }
  },
  machine: async ({ request, locals, params }) => {
    if (!locals.session || !env.CONTROL_DB)
      return fail(401, { kind: "machine", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const machine = await createMachine(
        env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        env.ENROLLMENT_TOKEN_PEPPER,
        {
          name: String(form.get("name") ?? "").trim(),
          expectedHost: String(form.get("expectedHost") ?? "").trim(),
          description: String(form.get("description") ?? "").trim(),
          labels: String(form.get("labels") ?? ""),
          samplingIntervalSeconds: Number(form.get("samplingIntervalSeconds")),
          reportIntervalSeconds: Number(form.get("reportIntervalSeconds")),
          offlineAfterSeconds: Number(form.get("offlineAfterSeconds")),
          containersEnabled: form.get("containersEnabled") === "on",
          maintenanceUntil: null,
        },
      );
      return { kind: "machine", machine };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Machine creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "machine", message });
    }
  },
  service: async ({ request, locals, params }) => {
    if (!locals.session || !env.CONTROL_DB)
      return fail(401, { kind: "service", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const result = await createServiceMonitor(
        env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        env.CHECK_SECRET_WRAPPING_KEY,
        {
          name: String(form.get("name") ?? "").trim(),
          description: String(form.get("description") ?? "").trim(),
          ...parseServiceCheckForm(form),
        },
      );
      return { kind: "service", created: true, serviceId: result.serviceId };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Service creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "service", message });
    }
  },
};
