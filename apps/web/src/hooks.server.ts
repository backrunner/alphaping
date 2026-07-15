import { building } from "$app/environment";
import { redirect, type Handle } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";

import { createAuth } from "$lib/server/auth";

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.auth = null;
  event.locals.session = null;
  const platform = event.platform;
  if (!platform) return resolve(event);

  const secret = platform.env.BETTER_AUTH_SECRET;
  const auth = createAuth(platform.env.CONTROL_DB, secret, event.url.origin);
  event.locals.auth = auth;
  event.locals.session = await auth.api.getSession({ headers: event.request.headers });

  const routeNeedsInstallation =
    !event.url.pathname.startsWith("/setup") &&
    !event.url.pathname.startsWith("/api/auth") &&
    !event.url.pathname.includes(".");
  if (routeNeedsInstallation) {
    const installation = await platform.env.CONTROL_DB.prepare(
      "SELECT 1 AS installed FROM installations WHERE state = 'complete' LIMIT 1",
    ).first<{ installed: number }>();
    if (!installation) throw redirect(303, "/setup");
  }

  const response = await svelteKitHandler({ event, resolve, auth, building });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
};
