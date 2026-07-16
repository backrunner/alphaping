import { LIVE_PROTOCOL, ticketFromProtocols, verifyLiveTicket } from "@alphaping/contracts";

import { LiveHub } from "./live-hub.js";

export { LiveHub };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/v1\/live\/([^/]+)$/.exec(url.pathname);
    if (request.method !== "GET" || match?.[1] === undefined) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const claims = await verifyLiveTicket(ticketFromProtocols(request), env.LIVE_TICKET_SECRET);
      if (claims.workspaceId !== match[1]) return new Response("Not found", { status: 404 });
      const headers = new Headers(request.headers);
      headers.set("x-alphaping-role", claims.role);
      headers.set("x-alphaping-subject", claims.subjectId);
      headers.set("x-alphaping-expires", String(claims.expiresAt));
      headers.set("x-alphaping-topics", JSON.stringify(claims.topics));
      headers.set("x-alphaping-projection", claims.projection);
      headers.set("x-alphaping-protocol", LIVE_PROTOCOL);
      if (claims.role === "agent") {
        headers.set("x-alphaping-session", claims.sessionId);
        headers.set("x-alphaping-nonce-prefix", claims.noncePrefix);
      }
      return env.LIVE_HUBS.getByName(claims.workspaceId).fetch(
        new Request(request.url, { method: "GET", headers }),
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
