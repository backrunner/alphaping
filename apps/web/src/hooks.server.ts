import { building } from "$app/environment";
import { redirect, type Handle } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";

import { createAuth } from "$lib/server/auth";
import { allowCredentialAttempt, emailFromBetterAuthRequest } from "$lib/server/auth-rate-limit";
import { requestBodyLimit, withBoundedRequestBody } from "$lib/server/request-body";

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

function applySecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
}

export const handle: Handle = async ({ event, resolve }) => {
  const pathname = event.url.pathname;
  event.request = await withBoundedRequestBody(event.request, requestBodyLimit(pathname));
  event.locals.auth = null;
  event.locals.session = null;
  const platform = event.platform;
  if (!platform) return resolve(event);

  if (pathname === "/api/auth/sign-in/email" && event.request.method === "POST") {
    const email = await emailFromBetterAuthRequest(event.request);
    const allowed = await allowCredentialAttempt(
      platform.env.AUTH_EDGE_RATE_LIMITER,
      platform.env.AUTH_ACCOUNT_RATE_LIMITER,
      event.request.headers,
      email,
    );
    if (!allowed) {
      const response = Response.json(
        { message: "Too many sign-in attempts. Try again later." },
        {
          status: 429,
          headers: { "cache-control": "private, no-store", "retry-after": "60" },
        },
      );
      applySecurityHeaders(response);
      return response;
    }
  }

  const setupRoute = pathname.startsWith("/setup");
  if (setupRoute) {
    const response = await resolve(event);
    applySecurityHeaders(response);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }

  if (isPublicStatusPath(pathname)) {
    const response = await resolve(event);
    applySecurityHeaders(response);
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
  applySecurityHeaders(response);
  if (requiresPrivateCaching(event.url.pathname, event.locals.session !== null)) {
    response.headers.set("cache-control", "private, no-store");
  }
  return response;
};
