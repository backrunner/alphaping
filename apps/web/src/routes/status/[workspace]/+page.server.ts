import { loadPublicStatusPage, PublicStatusNotFoundError } from "@alphaping/db";
import { error } from "@sveltejs/kit";

import {
  PUBLIC_STATUS_SNAPSHOT_CACHE,
  publicStatusSnapshotFreshMaxAge,
  readPublicStatusSnapshot,
  writePublicStatusSnapshot,
} from "$lib/server/public-status-snapshot";
import {
  normalizePublicStatusServicePage,
  PUBLIC_STATUS_SERVICE_PAGE_SIZE,
} from "$lib/public-status-view";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, platform, setHeaders, url }) => {
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  const now = Date.now();
  const servicePage = normalizePublicStatusServicePage(url.searchParams.get("servicePage"));
  const cache = await platform.caches.open(PUBLIC_STATUS_SNAPSHOT_CACHE).catch(() => null);
  const snapshot = cache
    ? await readPublicStatusSnapshot(cache, url.origin, params.workspace, now, servicePage).catch(
        () => null,
      )
    : null;
  const freshCacheMaxAge = snapshot
    ? publicStatusSnapshotFreshMaxAge(snapshot.cachedAt, now)
    : null;
  if (snapshot && freshCacheMaxAge !== null) {
    setHeaders({
      "cache-control": `public, max-age=${freshCacheMaxAge}, must-revalidate`,
      "x-alphaping-status-source": "cache",
      "x-robots-tag": "noindex",
    });
    return { ...snapshot.page, stale: false, snapshotAt: snapshot.cachedAt };
  }
  try {
    const page = await loadPublicStatusPage(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      now,
      { servicePage, servicePageSize: PUBLIC_STATUS_SERVICE_PAGE_SIZE },
    );
    if (cache) {
      await writePublicStatusSnapshot(cache, url.origin, page, now, servicePage).catch(
        () => undefined,
      );
    }
    setHeaders({
      "cache-control": "public, max-age=30, must-revalidate",
      "x-alphaping-status-source": "live",
      "x-robots-tag": "noindex",
    });
    return { ...page, stale: false, snapshotAt: now };
  } catch (cause) {
    if (cause instanceof PublicStatusNotFoundError) throw error(404, "Status page not found");
    if (snapshot) {
      setHeaders({
        "cache-control": "public, max-age=0, must-revalidate",
        "x-alphaping-status-source": "snapshot",
        "x-robots-tag": "noindex",
      });
      return { ...snapshot.page, stale: true, snapshotAt: snapshot.cachedAt };
    }
    throw cause;
  }
};
