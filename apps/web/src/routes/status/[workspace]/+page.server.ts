import { loadPublicStatusPage, PublicStatusNotFoundError } from "@alphaping/db";
import { error } from "@sveltejs/kit";

import {
  PUBLIC_STATUS_SNAPSHOT_CACHE,
  readPublicStatusSnapshot,
  writePublicStatusSnapshot,
} from "$lib/server/public-status-snapshot";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, platform, setHeaders, url }) => {
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  const now = Date.now();
  try {
    const page = await loadPublicStatusPage(
      platform.env.CONTROL_DB,
      platform.env.TELEMETRY_DB,
      params.workspace,
      now,
    );
    const cache = await platform.caches.open(PUBLIC_STATUS_SNAPSHOT_CACHE).catch(() => null);
    if (cache) {
      await writePublicStatusSnapshot(cache, url.origin, page, now).catch(() => undefined);
    }
    setHeaders({
      "cache-control": "public, max-age=30, must-revalidate",
      "x-alphaping-status-source": "live",
      "x-robots-tag": "noindex",
    });
    return { ...page, stale: false, snapshotAt: now };
  } catch (cause) {
    if (cause instanceof PublicStatusNotFoundError) throw error(404, "Status page not found");
    const cache = await platform.caches.open(PUBLIC_STATUS_SNAPSHOT_CACHE).catch(() => null);
    const snapshot = cache
      ? await readPublicStatusSnapshot(cache, url.origin, params.workspace, now).catch(() => null)
      : null;
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
