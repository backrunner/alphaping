export type DomainRoute =
  | { kind: "admin"; workspace: string }
  | { kind: "status"; workspace: string }
  | { kind: "machine"; workspace: string; resource: string }
  | { kind: "service"; workspace: string; resource: string };

const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_DOMAIN_ROUTES = 100;
const WORKSPACE_SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const RESOURCE_SLUG = /^[A-Za-z0-9_-]{1,200}$/;

export class DomainRoutingConfigError extends Error {}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeDomainHostname(value: string): string | null {
  const input = value.trim().toLowerCase().replace(/\.$/, "");
  if (input.length === 0 || input.length > 253 || input.includes("/")) return null;
  try {
    const url = new URL(`https://${input}`);
    if (
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function parseDomainRoutes(serialized: string): ReadonlyMap<string, DomainRoute> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_CONFIG_BYTES) {
    throw new DomainRoutingConfigError("domain route configuration is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized || "{}");
  } catch {
    throw new DomainRoutingConfigError("domain route configuration is not valid JSON");
  }
  if (!record(parsed) || Object.keys(parsed).length > MAX_DOMAIN_ROUTES) {
    throw new DomainRoutingConfigError("domain route configuration is invalid");
  }
  const routes = new Map<string, DomainRoute>();
  for (const [configuredHost, value] of Object.entries(parsed)) {
    const host = normalizeDomainHostname(configuredHost);
    if (!host || !record(value)) throw new DomainRoutingConfigError("domain route is invalid");
    const { kind, workspace, resource } = value;
    if (
      (kind !== "admin" && kind !== "status" && kind !== "machine" && kind !== "service") ||
      typeof workspace !== "string" ||
      !WORKSPACE_SLUG.test(workspace)
    ) {
      throw new DomainRoutingConfigError("domain route target is invalid");
    }
    if (
      (kind === "machine" || kind === "service") &&
      (typeof resource !== "string" || !RESOURCE_SLUG.test(resource))
    ) {
      throw new DomainRoutingConfigError("domain resource route is invalid");
    }
    if ((kind === "admin" || kind === "status") && resource !== undefined) {
      throw new DomainRoutingConfigError("domain route has an unexpected resource");
    }
    if (routes.has(host)) throw new DomainRoutingConfigError("domain route hostname is duplicated");
    routes.set(
      host,
      kind === "machine" || kind === "service"
        ? { kind, workspace, resource: resource as string }
        : { kind, workspace },
    );
  }
  return routes;
}

let cachedSerialized = "";
let cachedRoutes: ReadonlyMap<string, DomainRoute> = new Map();

export function domainRouteForRequest(serialized: string, hostname: string): DomainRoute | null {
  if (serialized !== cachedSerialized) {
    cachedRoutes = parseDomainRoutes(serialized);
    cachedSerialized = serialized;
  }
  const normalized = normalizeDomainHostname(hostname);
  return normalized ? (cachedRoutes.get(normalized) ?? null) : null;
}

export function domainRouteAllowsPath(route: DomainRoute, pathname: string): boolean {
  if (route.kind === "admin") return true;
  if (pathname === "/" || pathname === "/__data.json" || pathname.startsWith("/_app/")) return true;
  const statusRoot = `/status/${encodeURIComponent(route.workspace)}`;
  return pathname === statusRoot || pathname.startsWith(`${statusRoot}/`);
}
