import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import { loadDeveloperPanel } from "$lib/server/monitoring-access";
import { installerChecksums } from "$lib/server/installers";
import { createMachine, listDeletedResources, restoreResource } from "$lib/server/resources";
import { createServiceMonitor } from "$lib/server/service-config";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform, url }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  const panel = await loadDeveloperPanel(
    platform.env.CONTROL_DB,
    params.workspace,
    locals.session.user.id,
  );
  return {
    workspace: params.workspace,
    ingestOrigin: platform.env.INGEST_ORIGIN,
    installOrigin: url.origin,
    installerChecksums: await installerChecksums(),
    agents: panel.agents,
    deletedResources: await listDeletedResources(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
    ),
  };
};

export const actions: Actions = {
  restoreResource: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "restore", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const resourceType = String(form.get("resourceType"));
      if (resourceType !== "machine" && resourceType !== "service") {
        throw error(400, "Resource type is invalid");
      }
      await restoreResource(
        platform.env.CONTROL_DB,
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
  machine: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "machine", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const machine = await createMachine(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        platform.env.ENROLLMENT_TOKEN_PEPPER,
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
  service: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "service", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const assertionSources = form
        .getAll("assertionSource")
        .map(String)
        .filter((value) => value !== "none");
      const assertionOperators = form.getAll("assertionOperator").map(String);
      const assertionSelectors = form.getAll("assertionSelector").map(String);
      const assertionExpected = form.getAll("assertionExpected").map(String);
      const assertionSeverities = form.getAll("assertionSeverity").map(String);
      const result = await createServiceMonitor(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        platform.env.CHECK_SECRET_WRAPPING_KEY,
        {
          name: String(form.get("name") ?? "").trim(),
          description: String(form.get("description") ?? "").trim(),
          kind: String(form.get("kind")) as "http" | "tcp" | "icmp",
          executorKind: String(form.get("executorKind")) as "cloudflare" | "agent",
          executorAgentId: String(form.get("executorAgentId") ?? ""),
          intervalSeconds: Number(form.get("intervalSeconds")),
          timeoutMs: Number(form.get("timeoutMs")),
          failureConfirmations: Number(form.get("failureConfirmations")),
          recoveryConfirmations: Number(form.get("recoveryConfirmations")),
          url: String(form.get("url") ?? "").trim(),
          method: String(form.get("method") ?? "GET"),
          expectedStatuses: String(form.get("expectedStatuses") ?? "200"),
          maxRedirects: Number(form.get("maxRedirects") ?? 3),
          tlsVerify: form.get("tlsVerify") === "on",
          degradedAfterMs: form.get("degradedAfterMs") ? Number(form.get("degradedAfterMs")) : null,
          downAfterMs: form.get("downAfterMs") ? Number(form.get("downAfterMs")) : null,
          maxResponseBytes: Number(form.get("maxResponseBytes")),
          requestHeaders: String(form.get("requestHeaders") ?? ""),
          secretRequestHeaders: String(form.get("secretRequestHeaders") ?? ""),
          requestBody: String(form.get("requestBody") ?? ""),
          requestBodyIsSecret: form.get("requestBodyIsSecret") === "on",
          hostname: String(form.get("hostname") ?? "").trim(),
          serverName: String(form.get("serverName") ?? "").trim(),
          port: form.get("port") ? Number(form.get("port")) : null,
          useTls: form.get("useTls") === "on",
          tcpPayload: String(form.get("tcpPayload") ?? ""),
          tcpPayloadIsSecret: form.get("tcpPayloadIsSecret") === "on",
          tcpResponsePrefix: String(form.get("tcpResponsePrefix") ?? ""),
          assertions: assertionSources.map((source, index) => ({
            source: source as "header" | "jsonpath" | "body",
            operator: String(assertionOperators[index] ?? "exists") as
              | "exists"
              | "equals"
              | "contains"
              | "matches"
              | "type"
              | "greater_than"
              | "less_than",
            selector: String(assertionSelectors[index] ?? ""),
            expected: String(assertionExpected[index] ?? ""),
            severity: String(assertionSeverities[index] ?? "down") as "degraded" | "down",
          })),
        },
      );
      return { kind: "service", created: true, serviceId: result.serviceId };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Service creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "service", message });
    }
  },
};
