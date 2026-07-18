import { unwrapCheckSecret } from "@alphaping/contracts";
import { describe, expect, it } from "vitest";

import { compileServiceConfig, type CreateServiceMonitorInput } from "./service-config-compiler.js";

const WORKSPACE_ID = "workspace-test";
const WRAPPING_KEY = "11".repeat(32);

function serviceInput(
  overrides: Partial<CreateServiceMonitorInput> = {},
): CreateServiceMonitorInput {
  return {
    name: "Public API",
    description: "Production health endpoint",
    kind: "http",
    executorKind: "cloudflare",
    executorAgentId: "",
    intervalSeconds: 60,
    timeoutMs: 5_000,
    retryCount: 1,
    critical: true,
    failureConfirmations: 3,
    recoveryConfirmations: 2,
    url: "https://example.com/health",
    method: "GET",
    expectedStatuses: "200, 204",
    maxRedirects: 3,
    tlsVerify: true,
    degradedAfterMs: 1_000,
    downAfterMs: 3_000,
    maxResponseBytes: 65_536,
    requestHeaders: "Accept: application/json",
    secretRequestHeaders: "",
    requestBody: "",
    requestBodyIsSecret: false,
    hostname: "example.com",
    serverName: "",
    port: null,
    useTls: false,
    tcpPayload: "",
    tcpPayloadIsSecret: false,
    tcpResponsePrefix: "",
    assertions: [],
    ...overrides,
  };
}

async function decryptedSecret(
  config: Awaited<ReturnType<typeof compileServiceConfig>>,
  name: string,
): Promise<string> {
  const secret = config.secrets.find((candidate) => candidate.name === name);
  if (!secret) throw new Error(`missing secret ${name}`);
  return unwrapCheckSecret(
    { ciphertext: secret.wrappedValue, nonce: secret.nonce },
    WRAPPING_KEY,
    WORKSPACE_ID,
    secret.id,
  );
}

describe("service configuration compiler", () => {
  it("keeps HTTP secrets out of the executable request", async () => {
    const config = await compileServiceConfig(
      serviceInput({
        method: "POST",
        secretRequestHeaders: "Authorization: Bearer private-token",
        requestBody: '{"tenant":"private"}',
        requestBodyIsSecret: true,
      }),
      WORKSPACE_ID,
      WRAPPING_KEY,
    );

    expect(config.request).toMatchObject({
      headers: { Accept: "application/json" },
      body: null,
      expectedStatus: [200, 204],
      maxRedirects: 3,
      tlsVerify: true,
    });
    expect(JSON.stringify(config.request)).not.toContain("private-token");
    expect(JSON.stringify(config.request)).not.toContain("private");
    expect(config.secretRefs.headers.Authorization).toMatch(/^[0-9a-f-]{36}$/);
    expect(config.secretRefs.body).toMatch(/^[0-9a-f-]{36}$/);
    await expect(decryptedSecret(config, "header:Authorization")).resolves.toBe(
      "Bearer private-token",
    );
    await expect(decryptedSecret(config, "body")).resolves.toBe('{"tenant":"private"}');
  });

  it("rejects Cloudflare ICMP and duplicate public/secret headers", async () => {
    await expect(
      compileServiceConfig(
        serviceInput({ kind: "icmp", hostname: "example.com" }),
        WORKSPACE_ID,
        WRAPPING_KEY,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      compileServiceConfig(
        serviceInput({
          requestHeaders: "Authorization: public",
          secretRequestHeaders: "authorization: private",
        }),
        WORKSPACE_ID,
        WRAPPING_KEY,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects URL credentials instead of persisting them outside secret storage", async () => {
    await expect(
      compileServiceConfig(
        serviceInput({ url: "https://operator:private@example.com/health" }),
        WORKSPACE_ID,
        WRAPPING_KEY,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("validates direct POST enums and payload byte limits", async () => {
    await expect(
      compileServiceConfig(
        serviceInput({ kind: "udp" as CreateServiceMonitorInput["kind"] }),
        WORKSPACE_ID,
        WRAPPING_KEY,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      compileServiceConfig(
        serviceInput({ requestBody: "x".repeat(16_385) }),
        WORKSPACE_ID,
        WRAPPING_KEY,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      compileServiceConfig(
        serviceInput({
          assertions: [
            {
              source: "header",
              operator:
                "starts_with" as CreateServiceMonitorInput["assertions"][number]["operator"],
              selector: "content-type",
              expected: "application/json",
              severity: "down",
            },
          ],
        }),
        WORKSPACE_ID,
        WRAPPING_KEY,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps TLS verification and SNI scoped to Agent checks", async () => {
    await expect(
      compileServiceConfig(serviceInput({ tlsVerify: false }), WORKSPACE_ID, WRAPPING_KEY),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      compileServiceConfig(
        serviceInput({ kind: "tcp", serverName: "db.example.com" }),
        WORKSPACE_ID,
        WRAPPING_KEY,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("wraps Agent TCP payloads and compiles bounded response prefixes", async () => {
    const config = await compileServiceConfig(
      serviceInput({
        kind: "tcp",
        executorKind: "agent",
        executorAgentId: "agent-test",
        intervalSeconds: 5,
        hostname: "db.internal",
        serverName: "db.example.com",
        port: 5432,
        useTls: true,
        tcpPayload: "private probe",
        tcpPayloadIsSecret: true,
        tcpResponsePrefix: "ready",
      }),
      WORKSPACE_ID,
      WRAPPING_KEY,
    );

    expect(config.request).toMatchObject({
      hostname: "db.internal",
      port: 5432,
      secureTransport: "on",
      serverName: "db.example.com",
      tlsVerify: true,
      payloadBase64: null,
      responsePrefixBase64: "cmVhZHk=",
    });
    expect(config.secretRefs.tcpPayload).toMatch(/^[0-9a-f-]{36}$/);
    await expect(decryptedSecret(config, "tcpPayload")).resolves.toBe("private probe");
  });
});
