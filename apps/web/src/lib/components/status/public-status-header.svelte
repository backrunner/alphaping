<script lang="ts">
  import { AlertTriangle, CheckCircle2, Clock3, Wrench } from "lucide-svelte";
  import type { PublicStatusPage } from "@alphaping/db";

  import StatusLabel from "$components/status/status-label.svelte";

  let {
    workspace,
    dashboard,
    machines,
    services,
  }: Pick<PublicStatusPage, "workspace" | "dashboard" | "machines" | "services"> = $props();

  const overallState = $derived.by(() => {
    const states = [
      ...machines.map((machine) => machine.state),
      ...services.map((service) => service.state),
    ];
    if (states.some((state) => state === "down" || state === "offline")) return "down" as const;
    if (states.some((state) => state === "degraded")) return "degraded" as const;
    if (states.some((state) => state === "maintenance")) return "maintenance" as const;
    if (states.length > 0 && states.every((state) => state === "healthy")) {
      return "healthy" as const;
    }
    return "unknown" as const;
  });
</script>

<header class="status-header">
  <div class="brand"><span>A</span><strong>AlphaPing</strong></div>
  <div class="workspace-title">
    <div>
      <h1>{workspace.name}</h1>
      <p>{dashboard.name} monitor status</p>
    </div>
    <StatusLabel status={overallState} />
  </div>
  <div class={`summary summary--${overallState}`}>
    {#if overallState === "healthy"}<CheckCircle2 size={18} />All published monitors are operational
    {:else if overallState === "maintenance"}<Wrench size={18} />Scheduled maintenance is active
    {:else if overallState === "unknown"}<Clock3 size={18} />Status data is not available yet
    {:else}<AlertTriangle size={18} />One or more monitors are impaired{/if}
  </div>
</header>

<style>
  .status-header {
    padding-bottom: 24px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .brand span {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 5px;
    color: white;
    background: var(--accent);
    font-family: var(--font-mono);
    font-weight: 750;
  }

  .workspace-title {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-top: 24px;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    font-size: 24px;
  }

  .workspace-title p {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
    padding: 11px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    background: var(--surface);
    font-weight: 620;
  }

  .summary--healthy {
    border-color: var(--status-healthy);
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }

  .summary--degraded,
  .summary--maintenance {
    border-color: var(--status-degraded);
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
  }

  .summary--down {
    border-color: var(--status-down);
    color: var(--status-down);
    background: var(--status-down-bg);
  }
</style>
