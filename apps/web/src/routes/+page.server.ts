import {
  loadPublicMachineStatusPage,
  loadPublicServiceStatusPage,
  loadPublicStatusPage,
  PublicStatusDataError,
  PublicStatusNotFoundError,
} from "@alphaping/db";
import { error, redirect } from "@sveltejs/kit";

import {
  normalizePublicStatusServicePage,
  PUBLIC_STATUS_SERVICE_PAGE_SIZE,
} from "$lib/public-status-view";
import { listUserWorkspaces } from "$lib/server/workspace-lifecycle";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform, setHeaders, url }) => {
  if (locals.domainRoute?.kind === "admin") {
    if (!locals.session) throw redirect(303, "/login?returnTo=%2F");
    throw redirect(303, `/${locals.domainRoute.workspace}`);
  }
  if (locals.domainRoute) {
    if (!platform) throw error(503, "Cloudflare bindings are unavailable");
    try {
      const route = locals.domainRoute;
      setHeaders({
        "cache-control": "public, max-age=30, must-revalidate",
        "x-alphaping-domain-route": route.kind,
        "x-alphaping-status-source": "live",
        "x-robots-tag": "noindex",
      });
      if (route.kind === "status") {
        const now = Date.now();
        const page = await loadPublicStatusPage(
          platform.env.CONTROL_DB,
          platform.env.TELEMETRY_DB,
          route.workspace,
          now,
          {
            servicePage: normalizePublicStatusServicePage(url.searchParams.get("servicePage")),
            servicePageSize: PUBLIC_STATUS_SERVICE_PAGE_SIZE,
          },
        );
        return { kind: "status" as const, page: { ...page, stale: false, snapshotAt: now } };
      }
      if (route.kind === "machine") {
        return {
          kind: "machine" as const,
          page: await loadPublicMachineStatusPage(
            platform.env.CONTROL_DB,
            platform.env.TELEMETRY_DB,
            route.workspace,
            route.resource,
          ),
        };
      }
      return {
        kind: "service" as const,
        page: await loadPublicServiceStatusPage(
          platform.env.CONTROL_DB,
          platform.env.TELEMETRY_DB,
          route.workspace,
          route.resource,
        ),
      };
    } catch (cause) {
      if (cause instanceof PublicStatusNotFoundError) throw error(404, "Status page not found");
      if (cause instanceof PublicStatusDataError) throw error(503, "Status data is unavailable");
      throw cause;
    }
  }
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw redirect(303, "/login");
  const workspaces = await listUserWorkspaces(platform.env.CONTROL_DB, locals.session.user.id);
  const active = workspaces.filter((workspace) => workspace.deletedAt === null);
  if (active.length === 1 && active[0]) throw redirect(303, `/${active[0].slug}`);
  throw redirect(303, "/workspaces");
};
