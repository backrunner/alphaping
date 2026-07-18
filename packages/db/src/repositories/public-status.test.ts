import { describe, expect, it } from "vitest";

import { projectPublicStatusMachine, projectPublicStatusService } from "./public-status.js";

describe("public status projection", () => {
  it("contains only public service status fields", () => {
    const projected = projectPublicStatusService({
      service: {
        id: "service-internal-id",
        telemetry_pk: 7,
        name: "Public API",
        slug: "public-api",
        description: "Customer API",
        projection_profile: "detailed",
      },
      latest: {
        service_pk: 7,
        state: "healthy",
        last_transition_at: 100,
      },
      lastCheckedAt: 200,
      buckets: [],
      now: 300,
    });
    expect(Object.keys(projected).sort()).toEqual([
      "availability24hPermille",
      "description",
      "lastCheckedAt",
      "lastTransitionAt",
      "name",
      "slug",
      "state",
      "timeline",
    ]);
    expect(JSON.stringify(projected)).not.toContain("service-internal-id");
    for (const sensitive of ["url", "header", "payload", "agent", "diagnostic", "secret"]) {
      expect(JSON.stringify(projected).toLowerCase()).not.toContain(sensitive);
    }
  });

  it("aggregates each service timeline in one pass without mixing resources", () => {
    const halfHourMs = 30 * 60_000;
    const fiveMinutesMs = 5 * 60_000;
    const timelineStart = halfHourMs;
    const projected = projectPublicStatusService({
      service: {
        id: "service-7",
        telemetry_pk: 7,
        name: "Public API",
        slug: "public-api",
        description: "Customer API",
        projection_profile: "summary",
      },
      latest: undefined,
      lastCheckedAt: null,
      buckets: [
        {
          resource_pk: 7,
          bucket_start: timelineStart,
          state: "healthy",
          availability_permille: 1_000,
          latency_avg_ms: 10,
          summary_code: "healthy",
        },
        {
          resource_pk: 8,
          bucket_start: timelineStart,
          state: "down",
          availability_permille: 0,
          latency_avg_ms: 999,
          summary_code: "other-service-down",
        },
        {
          resource_pk: 7,
          bucket_start: timelineStart + fiveMinutesMs,
          state: "degraded",
          availability_permille: 800,
          latency_avg_ms: 30,
          summary_code: "latency-warning",
        },
        {
          resource_pk: 7,
          bucket_start: timelineStart + 2 * fiveMinutesMs,
          state: "degraded",
          availability_permille: 900,
          latency_avg_ms: null,
          summary_code: "later-warning",
        },
      ],
      now: 24 * 60 * 60_000 + halfHourMs / 2,
    });

    expect(projected.availability24hPermille).toBe(900);
    expect(projected.timeline[0]).toEqual({
      bucketStart: timelineStart,
      state: "degraded",
      availabilityPermille: 900,
      latencyMs: 20,
      summaryCode: "latency-warning",
    });
    expect(projected.timeline[1]?.state).toBe("unknown");
  });

  it("projects only explicitly public machine and container fields", () => {
    const projected = projectPublicStatusMachine({
      machine: {
        id: "machine-internal-id",
        telemetry_pk: 9,
        name: "Edge node",
        description: "Public edge capacity",
        offline_after_seconds: 150,
        projection_profile: "detailed",
      },
      latest: {
        machine_pk: 9,
        observed_at: 1_000,
        received_at: 1_000,
        state: "healthy",
        cpu_permille: 250,
        memory_used_bytes: 1_024,
        memory_total_bytes: 4_096,
        storage_used_bytes: 8_192,
        storage_total_bytes: 16_384,
        network_rx_bps: 100,
        network_tx_bps: 50,
        container_inventory_json: null,
      },
      inventory: {
        observedAt: 1_000,
        runtimes: [],
        containers: [
          {
            id: "container-internal-id",
            runtime: "docker",
            runtimeInstance: "default",
            name: "web",
            image: "private.example/internal/web:latest",
            state: "running",
            health: "healthy",
            startedAt: 100,
            restartCount: 0,
            cpuPermille: 20,
            memoryUsedBytes: 256,
            memoryLimitBytes: 512,
            networkRxBps: 10,
            networkTxBps: 5,
            ports: [{ privatePort: 8_080, publicPort: 443, protocol: "tcp" }],
          },
        ],
      },
      publicContainers: [
        {
          id: "container-internal-id",
          machine_id: "machine-internal-id",
          projection_profile: "summary",
        },
      ],
      now: 2_000,
    });

    expect(projected.name).toBe("Edge node");
    expect(projected.containers).toEqual([
      {
        name: "web",
        state: "running",
        health: "healthy",
        cpuPermille: null,
        memoryUsedBytes: null,
      },
    ]);
    for (const sensitive of [
      "machine-internal-id",
      "container-internal-id",
      "private.example",
      "8080",
      "agent",
    ]) {
      expect(JSON.stringify(projected).toLowerCase()).not.toContain(sensitive.toLowerCase());
    }
  });
});
