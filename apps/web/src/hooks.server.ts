import { building } from "$app/environment";
import { redirect, type Handle } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";

import { createAuth } from "$lib/server/auth";

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export function requiresPrivateCaching(pathname: string, authenticated: boolean): boolean {
  return (
    authenticated ||
    pathname === "/login" ||
    pathname.startsWith("/setup") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/api/auth")
  );
}

export function isPublicStatusPath(pathname: string): boolean {
  return pathname.startsWith("/status/");
}

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.auth = null;
  event.locals.session = null;
  const platform = event.platform;
  if (!platform) return resolve(event);

  const pathname = event.url.pathname;
  const setupRoute = pathname.startsWith("/setup");
  if (setupRoute) {
    const response = await resolve(event);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }

  if (isPublicStatusPath(pathname)) {
    const response = await resolve(event);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    return response;
  }

  const routeNeedsInstallation = !pathname.includes(".");
  if (routeNeedsInstallation) {
    const installation = await platform.env.CONTROL_DB.prepare(
      "SELECT 1 AS installed FROM installations WHERE state = 'complete' LIMIT 1",
    )
      .first<{ installed: number }>()
      .catch(() => null);
    if (!installation) {
      if (pathname.startsWith("/api/auth")) {
        return Response.json({ code: "INSTALLATION_REQUIRED" }, { status: 503 });
      }
      throw redirect(303, "/setup");
    }
  }

  const secret = platform.env.BETTER_AUTH_SECRET;
  const auth = createAuth(platform.env.CONTROL_DB, secret, event.url.origin);
  event.locals.auth = auth;
  event.locals.session = await auth.api.getSession({ headers: event.request.headers });

  const response = await svelteKitHandler({ event, resolve, auth, building });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (requiresPrivateCaching(event.url.pathname, event.locals.session !== null)) {
    response.headers.set("cache-control", "private, no-store");
  }
  return response;
};
