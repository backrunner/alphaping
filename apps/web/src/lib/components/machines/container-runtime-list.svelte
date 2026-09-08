<script lang="ts">
  import type { MachineContainerInventory } from "@alphaping/db";
  import {
    CheckCircle2,
    CircleHelp,
    PauseCircle,
    ShieldAlert,
    TriangleAlert,
  } from "@lucide/svelte";

  let { runtimes }: { runtimes: MachineContainerInventory["runtimes"] } = $props();

  const runtimeNames = {
    docker: "Docker Engine",
    "colima-docker": "Colima Docker",
    "colima-containerd": "Colima containerd",
    "apple-container": "Apple container",
    unknown: "Unknown runtime",
  } as const;

  const availabilityLabels = {
    available: "Available",
    absent: "Not detected",
    stopped: "Stopped",
    "permission-denied": "Permission required",
    incompatible: "Incompatible",
    error: "Collection error",
    unknown: "Unknown",
  } as const;

  function runtimeDetail(detailCode: string): string {
    const details: Record<string, string> = {
      socket_absent: "No local socket",
      profile_absent: "No matching profile",
      daemon_unavailable: "Runtime is not responding",
      permission_denied: "Agent cannot read this runtime",
      api_incompatible: "Unsupported API response",
      cli_absent: "Runtime command is not installed",
      profile_stopped: "Profile is not running",
      service_stopped: "Runtime service is stopped",
      unsupported_platform: "Not supported on this platform",
      list_incompatible: "Runtime output is not supported",
      query_timeout: "Runtime query timed out",
      query_failed: "Runtime query failed",
      request_failed: "Runtime request failed",
    };
    return details[detailCode] ?? "Runtime status reported by the Agent";
  }
</script>

<section aria-labelledby="runtime-heading">
  <header>
    <h2 id="runtime-heading">Runtime inventory</h2>
    <p>Read-only local detection</p>
  </header>
  <div class="runtime-grid">
    {#each runtimes as runtime (`${runtime.kind}-${runtime.instance}`)}
      <div class="runtime">
        <span class:available={runtime.availability === "available"} class="runtime-icon">
          {#if runtime.availability === "available"}
            <CheckCircle2 size={14} />
          {:else if runtime.availability === "permission-denied"}
            <ShieldAlert size={14} />
          {:else if runtime.availability === "stopped"}
            <PauseCircle size={14} />
          {:else if runtime.availability === "error" || runtime.availability === "incompatible"}
            <TriangleAlert size={14} />
          {:else}
            <CircleHelp size={14} />
          {/if}
        </span>
        <span class="runtime-copy">
          <strong>{runtimeNames[runtime.kind]}</strong>
          <small>{runtime.instance}{runtime.version ? ` · ${runtime.version}` : ""}</small>
        </span>
        <span class:available={runtime.availability === "available"} class="runtime-state">
          {availabilityLabels[runtime.availability]}
        </span>
        <small class="runtime-detail">{runtimeDetail(runtime.detailCode)}</small>
      </div>
    {/each}
  </div>
</section>

<style>
  section {
    padding-top: var(--space-5);
  }

  header {
    margin-bottom: var(--space-3);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: var(--text-base);
    font-weight: 600;
  }

  p {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .runtime-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    border-block: 1px solid var(--border);
  }

  .runtime {
    display: grid;
    min-width: 0;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .runtime + .runtime {
    border-left: 1px solid var(--border);
  }

  .runtime-icon,
  .runtime-state {
    color: var(--status-offline);
  }

  .runtime-icon.available,
  .runtime-state.available {
    color: var(--status-healthy);
  }

  .runtime-copy strong,
  .runtime-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runtime-copy strong {
    font-size: var(--text-sm);
  }

  .runtime-copy small,
  .runtime-detail {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .runtime-state {
    font-size: var(--text-xs);
  }

  .runtime-detail {
    grid-column: 2 / -1;
  }

  @media (max-width: 520px) {
    .runtime-grid {
      grid-template-columns: 1fr;
    }

    .runtime + .runtime {
      border-top: 1px solid var(--border);
      border-left: 0;
    }
  }
</style>
