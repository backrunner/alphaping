import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import { loadDeveloperPanel } from "$lib/server/monitoring-access";
import { createMachine } from "$lib/server/resources";
import { createServiceMonitor } from "$lib/server/service-config";

import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, platform }) => {
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
    agents: panel.agents,
  };
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
        platform.env.ENROLLMENT_TOKEN_PEPPER,
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
      const assertionSource = String(form.get("assertionSource") ?? "none");
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
          degradedAfterMs: form.get("degradedAfterMs") ? Number(form.get("degradedAfterMs")) : null,
          downAfterMs: form.get("downAfterMs") ? Number(form.get("downAfterMs")) : null,
          maxResponseBytes: Number(form.get("maxResponseBytes")),
          requestHeaders: String(form.get("requestHeaders") ?? ""),
          secretRequestHeaders: String(form.get("secretRequestHeaders") ?? ""),
          requestBody: String(form.get("requestBody") ?? ""),
          requestBodyIsSecret: form.get("requestBodyIsSecret") === "on",
          hostname: String(form.get("hostname") ?? "").trim(),
          port: form.get("port") ? Number(form.get("port")) : null,
          useTls: form.get("useTls") === "on",
          tcpPayload: String(form.get("tcpPayload") ?? ""),
          tcpPayloadIsSecret: form.get("tcpPayloadIsSecret") === "on",
          tcpResponsePrefix: String(form.get("tcpResponsePrefix") ?? ""),
          assertions:
            assertionSource === "none"
              ? []
              : [
                  {
                    source: assertionSource as "header" | "jsonpath" | "body",
                    operator: String(form.get("assertionOperator")) as
                      | "exists"
                      | "equals"
                      | "contains"
                      | "matches"
                      | "type"
                      | "greater_than"
                      | "less_than",
                    selector: String(form.get("assertionSelector") ?? ""),
                    expected: String(form.get("assertionExpected") ?? ""),
                    severity: String(form.get("assertionSeverity")) as "degraded" | "down",
                  },
                ],
        },
      );
      return { kind: "service", created: true, serviceId: result.serviceId };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Service creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "service", message });
    }
  },
};
