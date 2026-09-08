<script lang="ts">
  import { ArrowUpRight, Check, Clock3, TriangleAlert, Wrench } from "@lucide/svelte";
  import type { PublicStatusPage } from "@alphaping/db";
  import type { PublicStatusOverallState } from "$lib/public-status-view";

  let {
    dashboard,
    overallState,
    machineCount = 0,
    serviceCount = 0,
    incidentCount = 0,
  }: Pick<PublicStatusPage, "dashboard"> & {
    overallState: PublicStatusOverallState;
    machineCount?: number;
    serviceCount?: number;
    incidentCount?: number;
  } = $props();
  const stateText = $derived(
    overallState === "healthy"
      ? "All systems operational"
      : overallState === "maintenance"
        ? "Scheduled maintenance"
        : overallState === "unknown"
          ? "Awaiting status data"
          : overallState === "degraded"
            ? "Some systems are degraded"
            : "Service disruption detected",
  );
</script>

<header class={`status-header state-${overallState}`}>
  <div class="hero-content">
    <div class="status-heading">
      <span class="status-mark" aria-hidden="true"></span>
      <h1>{stateText}</h1>
    </div>
    {#if dashboard.appearance?.description}<p>{dashboard.appearance.description}</p>{/if}
    <div class="summary" aria-label="Published resources">
      <a href="#public-machines-title"
        ><strong>{machineCount}</strong> machines<ArrowUpRight size={13} /></a
      >
      <a href="#services-title"
        ><strong>{serviceCount}</strong> services<ArrowUpRight size={13} /></a
      >
      <span class:has-incidents={incidentCount > 0}>
        {#if incidentCount > 0}<strong>{incidentCount}</strong> active incidents{:else}No active
          incidents{/if}
      </span>
    </div>
  </div>
  <div class="status-illustration" aria-hidden="true">
    <span class="orbit-node node-top"></span>
    <span class="orbit-node node-left"></span>
    <span class="orbit-node node-bottom"></span>
    <div class="status-emblem">
      {#if overallState === "healthy"}<Check size={54} strokeWidth={1.8} />
      {:else if overallState === "maintenance"}<Wrench size={46} strokeWidth={1.8} />
      {:else if overallState === "unknown"}<Clock3 size={48} strokeWidth={1.8} />
      {:else}<TriangleAlert size={50} strokeWidth={1.8} />{/if}
    </div>
  </div>
</header>

<style>
  .status-header {
    --signal: var(--status-healthy);
    display: grid;
    grid-template-columns: minmax(0, 1fr) 248px;
    align-items: center;
    gap: 36px;
    min-height: 310px;
    padding: 48px;
    margin: 12px 0 40px;
    border: 1px solid var(--border);
    border-radius: 36px;
    background: linear-gradient(
      120deg,
      var(--surface) 35%,
      color-mix(in srgb, var(--palette-companion) 14%, var(--surface))
    );
    box-shadow: var(--shadow-panel);
  }
  .hero-content {
    min-width: 0;
  }
  .status-illustration {
    position: relative;
    display: grid;
    place-items: center;
    width: 248px;
    aspect-ratio: 1;
    pointer-events: none;
  }
  .status-illustration::before,
  .status-illustration::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    border-radius: 50%;
  }
  .status-illustration::after {
    inset: 11%;
  }
  .orbit-node {
    position: absolute;
    width: 12px;
    height: 12px;
    border: 3px solid var(--accent);
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 7%, transparent);
    transform: translate(-50%, -50%);
  }
  .node-top {
    top: 6.7%;
    left: 75%;
    border-color: var(--palette-companion);
  }
  .node-left {
    top: 60%;
    left: 1%;
  }
  .node-bottom {
    top: 85.36%;
    left: 85.36%;
    width: 8px;
    height: 8px;
    border-width: 2px;
    border-color: var(--palette-companion);
  }
  .status-emblem {
    display: grid;
    place-items: center;
    width: 136px;
    height: 136px;
    border: 1px solid color-mix(in srgb, var(--signal) 12%, var(--surface));
    border-radius: 44px;
    color: var(--signal);
    background: linear-gradient(
      145deg,
      var(--surface),
      color-mix(in srgb, var(--signal) 9%, var(--surface))
    );
    box-shadow:
      0 4px 8px color-mix(in srgb, var(--signal) 5%, transparent),
      0 24px 44px -18px color-mix(in srgb, var(--signal) 24%, transparent);
  }
  .state-down {
    --signal: var(--status-down);
  }
  .state-degraded {
    --signal: var(--status-degraded);
  }
  .state-maintenance {
    --signal: var(--status-maintenance);
  }
  .state-unknown {
    --signal: var(--text-muted);
  }
  .status-heading {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }
  .status-mark {
    margin-top: 19px;
    width: 13px;
    height: 13px;
    flex: none;
    border-radius: 50%;
    background: var(--signal);
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--signal) 10%, var(--bg));
  }
  h1 {
    margin: 0;
    font-size: 42px;
    line-height: 1.2;
    font-weight: 580;
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  p {
    max-width: 64ch;
    margin: 18px 0 0 29px;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.75;
    overflow-wrap: anywhere;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 28px;
    margin: 24px 0 0 29px;
  }
  .summary a,
  .summary > span {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 13px;
    text-decoration: none;
  }
  .summary strong {
    color: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .summary a:hover {
    color: var(--accent);
  }
  .summary .has-incidents {
    color: var(--status-down);
  }
  @media (max-width: 900px) {
    .status-header {
      grid-template-columns: minmax(0, 1fr) 180px;
      padding: 36px;
      gap: 24px;
    }
    .status-illustration {
      width: 180px;
    }
    .status-emblem {
      width: 112px;
      height: 112px;
      border-radius: 36px;
    }
    h1 {
      font-size: 36px;
    }
    .status-mark {
      margin-top: 15px;
    }
  }
  @media (max-width: 620px) {
    .status-header {
      grid-template-columns: minmax(0, 1fr);
      min-height: 0;
      padding: 32px 24px;
      margin: 8px 0 32px;
      border-radius: 28px;
    }
    .status-illustration {
      display: none;
    }
    .status-heading {
      align-items: flex-start;
      gap: 13px;
    }
    .status-mark {
      margin-top: 12px;
      width: 10px;
      height: 10px;
    }
    h1 {
      font-size: 32px;
    }
    p,
    .summary {
      margin-left: 0;
    }
    .summary {
      gap: 8px 20px;
    }
  }
</style>
