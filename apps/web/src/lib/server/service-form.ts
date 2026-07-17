import type { CreateServiceMonitorInput } from "./service-config-compiler.js";

export type ServiceCheckFormInput = Omit<CreateServiceMonitorInput, "name" | "description">;

export function parseServiceCheckForm(form: FormData): ServiceCheckFormInput {
  const assertionSources = form
    .getAll("assertionSource")
    .map(String)
    .filter((value) => value !== "none");
  const assertionOperators = form.getAll("assertionOperator").map(String);
  const assertionSelectors = form.getAll("assertionSelector").map(String);
  const assertionExpected = form.getAll("assertionExpected").map(String);
  const assertionSeverities = form.getAll("assertionSeverity").map(String);
  return {
    kind: String(form.get("kind")) as ServiceCheckFormInput["kind"],
    executorKind: String(form.get("executorKind")) as ServiceCheckFormInput["executorKind"],
    executorAgentId: String(form.get("executorAgentId") ?? ""),
    intervalSeconds: Number(form.get("intervalSeconds")),
    timeoutMs: Number(form.get("timeoutMs")),
    retryCount: Number(form.get("retryCount")),
    critical: form.get("critical") !== "off",
    failureConfirmations: Number(form.get("failureConfirmations")),
    recoveryConfirmations: Number(form.get("recoveryConfirmations")),
    url: String(form.get("url") ?? "").trim(),
    method: String(form.get("method") ?? "GET"),
    expectedStatuses: String(form.get("expectedStatuses") ?? "200"),
    maxRedirects: Number(form.get("maxRedirects") ?? 3),
    tlsVerify: form.get("tlsVerify") !== "off",
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
      source: source as ServiceCheckFormInput["assertions"][number]["source"],
      operator: String(
        assertionOperators[index] ?? "exists",
      ) as ServiceCheckFormInput["assertions"][number]["operator"],
      selector: String(assertionSelectors[index] ?? ""),
      expected: String(assertionExpected[index] ?? ""),
      severity: String(
        assertionSeverities[index] ?? "down",
      ) as ServiceCheckFormInput["assertions"][number]["severity"],
    })),
  };
}
