import { connect } from "cloudflare:sockets";

import type { ExecutedCheck, HttpCheckRequest, TcpCheckRequest } from "./types.js";
import { assertPublicHostname } from "./validation.js";

const MAX_REDIRECTS = 3;

export async function executeHttp(
  config: HttpCheckRequest,
  timeoutMs: number,
): Promise<ExecutedCheck> {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  let target = new URL(config.url);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      assertPublicHostname(target.hostname);
      const response = await fetch(target, {
        method: config.method,
        headers: config.headers,
        body: config.method === "GET" || config.method === "HEAD" ? null : config.body,
        redirect: "manual",
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (location === null || redirect === MAX_REDIRECTS) {
          return { state: "down", latencyMs: null, failureCode: "redirect_limit" };
        }
        target = new URL(location, target);
        continue;
      }
      await response.body?.cancel();
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (!config.expectedStatus.includes(response.status)) {
        return { state: "down", latencyMs, failureCode: "unexpected_status" };
      }
      return {
        state:
          config.degradedAfterMs !== null && latencyMs >= config.degradedAfterMs
            ? "degraded"
            : "healthy",
        latencyMs,
        failureCode: null,
      };
    }
  } catch (error) {
    return {
      state: "down",
      latencyMs: null,
      failureCode:
        error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  return { state: "down", latencyMs: null, failureCode: "internal" };
}

export async function executeTcp(
  config: TcpCheckRequest,
  timeoutMs: number,
): Promise<ExecutedCheck> {
  const startedAt = performance.now();
  try {
    const socket = connect(
      { hostname: config.hostname, port: config.port },
      { secureTransport: config.secureTransport, allowHalfOpen: false },
    );
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new DOMException("Timed out", "TimeoutError")), timeoutMs),
      ),
    ]);
    await socket.close();
    return {
      state: "healthy",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      failureCode: null,
    };
  } catch (error) {
    return {
      state: "down",
      latencyMs: null,
      failureCode:
        error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network",
    };
  }
}
