<script lang="ts">
  import {
    CircleHelp,
    CircleX,
    Clock3,
    TriangleAlert,
    WifiOff,
    Wrench,
    Check,
  } from "lucide-svelte";

  type Status = "healthy" | "degraded" | "down" | "offline" | "maintenance" | "unknown";
  let { status, compact = false }: { status: Status; compact?: boolean } = $props();

  const labels: Record<Status, string> = {
    healthy: "Healthy",
    degraded: "Degraded",
    down: "Fault",
    offline: "Offline",
    maintenance: "Maintenance",
    unknown: "Unknown",
  };
</script>

<span class:compact class={`status status--${status}`} aria-label={`Status: ${labels[status]}`}>
  {#if status === "healthy"}
    <Check size={12} strokeWidth={2.2} />
  {:else if status === "degraded"}
    <TriangleAlert size={12} strokeWidth={2.2} />
  {:else if status === "down"}
    <CircleX size={12} strokeWidth={2.2} />
  {:else if status === "offline"}
    <WifiOff size={12} strokeWidth={2.2} />
  {:else if status === "maintenance"}
    <Wrench size={12} strokeWidth={2.2} />
  {:else if status === "unknown"}
    <CircleHelp size={12} strokeWidth={2.2} />
  {:else}
    <Clock3 size={12} strokeWidth={2.2} />
  {/if}
  {#if !compact}<span>{labels[status]}</span>{/if}
</span>

<style>
  .status {
    display: inline-flex;
    height: 22px;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 650;
    white-space: nowrap;
  }

  .status.compact {
    width: 22px;
    padding: 0;
    justify-content: center;
  }

  .status--healthy {
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }

  .status--degraded {
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
  }

  .status--down {
    color: var(--status-down);
    background: var(--status-down-bg);
  }

  .status--offline,
  .status--unknown {
    color: var(--status-offline);
    background: var(--status-offline-bg);
  }

  .status--maintenance {
    color: var(--status-maintenance);
    background: var(--status-maintenance-bg);
  }
</style>
