import { connect } from "cloudflare:sockets";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeHttp, executeTcp, executeWithRetries } from "./executor.js";
import { parseHttpRequest, parseTcpRequest } from "./validation.js";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("check retry policy", () => {
  it("stops after success within the configured retry bound", async () => {
    let attempts = 0;
    const result = await executeWithRetries(async () => {
      attempts += 1;
      return attempts < 3
        ? { state: "down", latencyMs: null, failureCode: "network", failureSummary: null }
        : { state: "healthy", latencyMs: 12, failureCode: null, failureSummary: null };
    }, 3);
    expect(attempts).toBe(3);
    expect(result.state).toBe("healthy");
  });
});

describe("HTTP check execution", () => {
  it("evaluates bounded JSON assertions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { ready: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const config = parseHttpRequest(
      JSON.stringify({
        url: "https://api.example.com/health",
        expectedStatus: [200],
        assertions: [
          {
            source: "jsonpath",
            operator: "equals",
            selector: "$.data.ready",
            expected: true,
            severity: "down",
          },
        ],
      }),
    );
    await expect(executeHttp(config, 1_000)).resolves.toMatchObject({
      state: "healthy",
      failureCode: null,
    });
  });

  it("does not forward configured secret headers across origins", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://redirect.example.net/health" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      ...parseHttpRequest(
        JSON.stringify({
          url: "https://api.example.com/health",
          expectedStatus: [204],
          headers: { "x-public": "visible", "x-private-token": "hidden" },
        }),
      ),
      sensitiveHeaders: ["x-private-token"],
    };
    const result = await executeHttp(config, 1_000);
    expect(result.state).toBe("healthy");
    const secondOptions = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const secondHeaders = new Headers(secondOptions?.headers);
    expect(secondHeaders.get("x-public")).toBe("visible");
    expect(secondHeaders.has("x-private-token")).toBe(false);
  });

  it("rejects redirects to non-unicast IP literals before another fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://[::1]/metadata" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = parseHttpRequest(JSON.stringify({ url: "https://api.example.com/health" }));

    await expect(executeHttp(config, 1_000)).resolves.toMatchObject({
      state: "down",
      failureCode: "network",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies timeout and oversized response failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")),
    );
    const basic = parseHttpRequest(JSON.stringify({ url: "https://api.example.com" }));
    await expect(executeHttp(basic, 100)).resolves.toMatchObject({
      state: "down",
      failureCode: "timeout",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(2_048), { status: 200 })),
    );
    const bounded = parseHttpRequest(
      JSON.stringify({
        url: "https://api.example.com",
        maxResponseBytes: 1_024,
        assertions: [{ source: "body", operator: "contains", expected: "ok", severity: "down" }],
      }),
    );
    await expect(executeHttp(bounded, 1_000)).resolves.toMatchObject({
      state: "down",
      failureCode: "response_too_large",
    });
  });
});

describe("TCP check execution", () => {
  it("uses TLS and verifies a bounded response prefix", async () => {
    const writes: Uint8Array[] = [];
    const socket: Socket = {
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("PONG ready"));
          controller.close();
        },
      }),
      writable: new WritableStream({
        write(chunk) {
          writes.push(chunk as Uint8Array);
        },
      }),
      closed: Promise.resolve(),
      opened: Promise.resolve({ remoteAddress: "203.0.113.10:443" }),
      upgraded: false,
      secureTransport: "on",
      close: vi.fn().mockResolvedValue(undefined),
      startTls: vi.fn(),
    };
    vi.mocked(connect).mockReturnValue(socket);
    const config = parseTcpRequest(
      JSON.stringify({
        hostname: "api.example.com",
        port: 443,
        secureTransport: "on",
        payloadBase64: btoa("PING"),
        responsePrefixBase64: btoa("PONG"),
      }),
    );
    await expect(executeTcp(config, 1_000)).resolves.toMatchObject({ state: "healthy" });
    expect(connect).toHaveBeenCalledWith(
      { hostname: "api.example.com", port: 443 },
      { secureTransport: "on", allowHalfOpen: true },
    );
    expect(new TextDecoder().decode(writes[0])).toBe("PING");
  });

  it("classifies DNS, TLS, and connection failures without diagnostics", async () => {
    const socket: Socket = {
      readable: new ReadableStream(),
      writable: new WritableStream(),
      closed: Promise.resolve(),
      opened: Promise.reject(new Error("certificate or DNS failure")),
      upgraded: false,
      secureTransport: "on",
      close: vi.fn().mockResolvedValue(undefined),
      startTls: vi.fn(),
    };
    vi.mocked(connect).mockReturnValue(socket);
    const result = await executeTcp(
      parseTcpRequest(
        JSON.stringify({ hostname: "api.example.com", port: 443, secureTransport: "on" }),
      ),
      1_000,
    );
    expect(result).toEqual({
      state: "down",
      latencyMs: null,
      failureCode: "network",
      failureSummary: null,
    });
  });
});
