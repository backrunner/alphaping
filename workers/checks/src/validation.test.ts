import { describe, expect, it } from "vitest";

import { assertPublicHostname, parseHttpRequest, parseTcpRequest } from "./validation.js";

describe("central check validation", () => {
  it("blocks private and local targets", () => {
    for (const hostname of [
      "localhost",
      "127.0.0.1",
      "10.0.0.8",
      "service.internal",
      "::1",
      "[::1]",
      "::",
      "[::ffff:127.0.0.1]",
      "0.0.0.0",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "2130706433",
      "0177.0.0.1",
      "0x7f000001",
      "ff02::1",
    ]) {
      expect(() => assertPublicHostname(hostname)).toThrow("blocked_target");
    }
  });

  it("allows public DNS and unicast IP targets", () => {
    for (const hostname of [
      "status.example.com",
      "8.8.8.8",
      "2606:4700:4700::1111",
      "[2606:4700:4700::1111]",
    ]) {
      expect(() => assertPublicHostname(hostname)).not.toThrow();
    }
  });

  it("rejects bracketed and non-canonical loopback check targets", () => {
    expect(() => parseHttpRequest(JSON.stringify({ url: "http://[::1]/health" }))).toThrow(
      "blocked_target",
    );
    expect(() => parseTcpRequest(JSON.stringify({ hostname: "2130706433", port: 80 }))).toThrow(
      "blocked_target",
    );
  });

  it("parses bounded HTTP assertion settings", () => {
    const config = parseHttpRequest(
      JSON.stringify({
        url: "https://status.example.com/health",
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
        expectedStatus: [200, 204],
        degradedAfterMs: 800,
        downAfterMs: 2_000,
        maxRedirects: 1,
        maxResponseBytes: 32_768,
        assertions: [
          {
            source: "jsonpath",
            operator: "equals",
            selector: "$.ready",
            expected: true,
            severity: "down",
          },
        ],
      }),
    );
    expect(config.assertions).toHaveLength(1);
    expect(config.maxResponseBytes).toBe(32_768);
    expect(config.expectedStatus).toEqual([200, 204]);
  });

  it("rejects executable JSONPath expressions and oversized TCP payloads", () => {
    expect(() =>
      parseHttpRequest(
        JSON.stringify({
          url: "https://example.com",
          assertions: [
            {
              source: "jsonpath",
              operator: "exists",
              selector: "$[?(@.ready)]",
              expected: null,
              severity: "down",
            },
          ],
        }),
      ),
    ).toThrow("unsafe_jsonpath_selector");
    expect(() =>
      parseTcpRequest(
        JSON.stringify({
          hostname: "example.com",
          port: 443,
          payloadBase64: "A".repeat(5_465),
        }),
      ),
    ).toThrow("invalid_tcp_payload");
  });

  it("keeps central TLS verification enabled and rejects custom SNI", () => {
    expect(() =>
      parseHttpRequest(JSON.stringify({ url: "https://example.com", tlsVerify: false })),
    ).toThrow("tls_verification_disabled");
    expect(() =>
      parseTcpRequest(JSON.stringify({ hostname: "example.com", port: 443, tlsVerify: false })),
    ).toThrow("tls_verification_disabled");
    expect(() =>
      parseTcpRequest(
        JSON.stringify({ hostname: "example.com", port: 443, serverName: "edge.example.com" }),
      ),
    ).toThrow("server_name_unsupported");
  });
});
