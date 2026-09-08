import { connect } from "cloudflare:sockets";

import { evaluateAssertions } from "./assertions.js";
import type { ExecutedCheck, HttpCheckRequest, TcpCheckRequest } from "./types.js";
import { assertPublicHostname } from "./validation.js";

const REDIRECT_SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
]);

function outcome(
  state: ExecutedCheck["state"],
  latencyMs: number | null,
  failureCode: string | null,
  failureSummary: string | null = null,
): ExecutedCheck {
  return { state, latencyMs, failureCode, failureSummary };
}

export async function executeWithRetries(
  execute: () => Promise<ExecutedCheck>,
  retryCount: number,
): Promise<ExecutedCheck> {
  let result = await execute();
  for (let retry = 0; result.state === "down" && retry < retryCount; retry += 1) {
    result = await execute();
  }
  return result;
}

function redirectHeaders(
  configured: Headers,
  from: URL,
  to: URL,
  sensitiveHeaders: readonly string[],
): Headers {
  const headers = new Headers(configured);
  if (from.origin !== to.origin) {
    const names: string[] = [];
    headers.forEach((_value, name) => names.push(name));
    for (const name of names) {
      const normalized = name.toLowerCase();
      if (REDIRECT_SENSITIVE_HEADERS.has(normalized) || sensitiveHeaders.includes(normalized)) {
        headers.delete(name);
      }
    }
  }
  return headers;
}

function assertPublicUrl(url: URL): void {
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("url_credentials_unsupported");
  }
  assertPublicHostname(url.hostname);
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error("response_too_large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function executeHttp(
  config: HttpCheckRequest,
  timeoutMs: number,
): Promise<ExecutedCheck> {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  let target = new URL(config.url);
  let headers = new Headers(config.headers);
  let method = config.method;
  let body = method === "GET" || method === "HEAD" ? null : config.body;

  try {
    for (let redirect = 0; redirect <= config.maxRedirects; redirect += 1) {
      assertPublicUrl(target);
      const response = await fetch(target, {
        method,
        headers,
        body,
        redirect: "manual",
        signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (location === null || redirect === config.maxRedirects) {
          return outcome("down", null, "redirect_limit");
        }
        const nextTarget = new URL(location, target);
        assertPublicUrl(nextTarget);
        if (target.protocol === "https:" && nextTarget.protocol !== "https:") {
          return outcome("down", null, "redirect_downgrade");
        }
        if (
          ((response.status === 301 || response.status === 302) && method === "POST") ||
          (response.status === 303 && method !== "HEAD")
        ) {
          method = "GET";
          body = null;
          for (const name of [
            "content-type",
            "content-length",
            "content-encoding",
            "content-language",
            "content-location",
          ]) {
            headers.delete(name);
          }
        }
        if (body && target.origin !== nextTarget.origin) {
          return outcome("down", null, "redirect_body_blocked");
        }
        headers = redirectHeaders(headers, target, nextTarget, config.sensitiveHeaders);
        target = nextTarget;
        continue;
      }
      let latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (!config.expectedStatus.includes(response.status)) {
        await response.body?.cancel();
        return outcome("down", latencyMs, "unexpected_status", `status:${response.status}`);
      }
      const needsBody = config.assertions.some(
        (assertion) => assertion.source === "body" || assertion.source === "jsonpath",
      );
      const responseBody = needsBody
        ? await readBoundedText(response, config.maxResponseBytes)
        : "";
      if (!needsBody) await response.body?.cancel();
      latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const assertions = evaluateAssertions(config.assertions, response.headers, responseBody);
      if (config.downAfterMs !== null && latencyMs >= config.downAfterMs) {
        return outcome("down", latencyMs, "latency_threshold", `latency>=${config.downAfterMs}ms`);
      }
      if (assertions.state === "down") {
        return outcome("down", latencyMs, assertions.failureCode, assertions.failureSummary);
      }
      if (config.degradedAfterMs !== null && latencyMs >= config.degradedAfterMs) {
        return outcome(
          "degraded",
          latencyMs,
          "latency_threshold",
          `latency>=${config.degradedAfterMs}ms`,
        );
      }
      return outcome(
        assertions.state,
        latencyMs,
        assertions.failureCode,
        assertions.failureSummary,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "response_too_large") {
      return outcome("down", null, "response_too_large");
    }
    return outcome(
      "down",
      null,
      error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network",
    );
  }
  return outcome("down", null, "internal");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DOMException("Timed out", "TimeoutError")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function remainingTimeout(startedAt: number, timeoutMs: number): number {
  return Math.max(1, timeoutMs - Math.round(performance.now() - startedAt));
}

async function exchangeTcpPayload(
  socket: ReturnType<typeof connect>,
  config: TcpCheckRequest,
  startedAt: number,
  timeoutMs: number,
): Promise<boolean> {
  if (config.payload !== null) {
    const writer = socket.writable.getWriter();
    try {
      await withTimeout(writer.write(config.payload), remainingTimeout(startedAt, timeoutMs));
    } finally {
      writer.releaseLock();
    }
  }
  if (config.responsePrefix === null) return true;
  const expected = config.responsePrefix;
  const received = new Uint8Array(new ArrayBuffer(expected.byteLength));
  const reader = socket.readable.getReader();
  let offset = 0;
  try {
    while (offset < expected.byteLength) {
      const { done, value } = await withTimeout(
        reader.read(),
        remainingTimeout(startedAt, timeoutMs),
      );
      if (done) return false;
      const length = Math.min(value.byteLength, expected.byteLength - offset);
      received.set(value.subarray(0, length), offset);
      offset += length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return received.every((value, index) => value === expected[index]);
}

export async function executeTcp(
  config: TcpCheckRequest,
  timeoutMs: number,
): Promise<ExecutedCheck> {
  const startedAt = performance.now();
  assertPublicHostname(config.hostname);
  const socket = connect(
    { hostname: config.hostname, port: config.port },
    { secureTransport: config.secureTransport, allowHalfOpen: true },
  );
  try {
    await withTimeout(socket.opened, timeoutMs);
    if (!(await exchangeTcpPayload(socket, config, startedAt, timeoutMs))) {
      return outcome(
        "down",
        Math.max(0, Math.round(performance.now() - startedAt)),
        "prefix_mismatch",
      );
    }
    return outcome("healthy", Math.max(0, Math.round(performance.now() - startedAt)), null);
  } catch (error) {
    return outcome(
      "down",
      null,
      error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network",
    );
  } finally {
    await socket.close().catch(() => undefined);
  }
}
