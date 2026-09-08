<script lang="ts">
  import { ArrowDown, ArrowUp, Box, Clock3 } from "@lucide/svelte";
  import type { PublicStatusMachine } from "@alphaping/db";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatBytes, formatPercent, formatRate, formatRelativeTime } from "$lib/utils/format";
  let { machine, workspaceSlug }: { machine: PublicStatusMachine; workspaceSlug: string } =
    $props();
  const metrics = $derived([
    {
      name: "CPU",
      value: machine.cpuPermille === null ? "—" : formatPercent(machine.cpuPermille),
      detail: "utilization",
      percent: Math.max(0, Math.min(100, (machine.cpuPermille ?? 0) / 10)),
    },
    {
      name: "Memory",
      value: machine.memoryUsedBytes === null ? "—" : formatBytes(machine.memoryUsedBytes),
      detail:
        machine.memoryTotalBytes === null ? "" : `of ${formatBytes(machine.memoryTotalBytes)}`,
      percent: machine.memoryTotalBytes
        ? Math.min(100, (100 * (machine.memoryUsedBytes ?? 0)) / machine.memoryTotalBytes)
        : 0,
    },
    {
      name: "Storage",
      value: machine.storageUsedBytes === null ? "—" : formatBytes(machine.storageUsedBytes),
      detail:
        machine.storageTotalBytes === null ? "" : `of ${formatBytes(machine.storageTotalBytes)}`,
      percent: machine.storageTotalBytes
        ? Math.min(100, (100 * (machine.storageUsedBytes ?? 0)) / machine.storageTotalBytes)
        : 0,
    },
  ]);
</script>

<a
  class="machine"
  href={`/status/${workspaceSlug}/machines/${machine.slug}`}
  aria-label={`Open ${machine.name} machine status`}
>
  <header>
    <h3>{machine.name}</h3>
    <StatusLabel status={machine.state} />
  </header>
  <p class="description">{machine.description}</p>
  {#if machine.cpuPermille !== null}
    <div class="metrics">
      {#each metrics as metric}
        <div class="metric">
          <span>{metric.name}</span><strong>{metric.value}</strong><small>{metric.detail}</small>
          <div class="meter" aria-hidden="true"><i style:width={`${metric.percent}%`}></i></div>
        </div>
      {/each}
    </div>
    <div class="network">
      <span
        ><ArrowDown size={13} /><strong>{formatRate(machine.networkRxBps ?? 0)}</strong><small
          >down</small
        ></span
      ><span
        ><ArrowUp size={13} /><strong>{formatRate(machine.networkTxBps ?? 0)}</strong><small
          >up</small
        ></span
      >
    </div>
  {:else}
    <div class="summary-only">
      <span class="summary-line"></span><span
        >Status only<small>Resource metrics are private</small></span
      >
    </div>
  {/if}
  <footer>
    <span
      ><Clock3 size={12} />{machine.observedAt === null
        ? "Awaiting first report"
        : formatRelativeTime(machine.observedAt)}</span
    >{#if machine.containers.length > 0}<span
        ><Box size={12} />{machine.containers.length} workloads</span
      >{/if}
  </footer>
</a>

<style>
  .machine {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 20px 20px 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow-card);
    text-decoration: none;
    transition:
      box-shadow 180ms ease,
      border-color 180ms ease;
  }
  .machine:hover {
    box-shadow: var(--shadow-card-hover);
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }
  h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0;
    font-size: 17px;
    font-weight: 580;
    overflow-wrap: anywhere;
  }
  .machine:hover h3 {
    color: var(--accent);
  }
  p {
    min-height: 20px;
    margin: 6px 0 22px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.65;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .metric {
    display: grid;
    min-width: 0;
    gap: 6px;
  }
  .metric > span {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .metric strong {
    font-family: var(--font-mono);
    font-size: 16px;
    white-space: nowrap;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }
  .metric small {
    color: var(--text-faint);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meter {
    height: 4px;
    margin-top: 3px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-strong);
  }
  .meter i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--text-muted);
  }
  .network {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    padding: 16px 0;
  }
  .network > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .network strong {
    color: var(--text);
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 11px;
  }
  .network small {
    font-size: 11px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px;
    margin-top: auto;
    padding: 12px 0;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11px;
  }
  footer > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .summary-only {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 78px;
    padding-bottom: 22px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .summary-only small {
    display: block;
    margin-top: 5px;
    font-size: 11px;
    color: var(--text-faint);
  }
  .summary-line {
    display: block;
    height: 34px;
    width: 4px;
    border-radius: 2px;
    background: var(--accent-soft);
  }
  :global([data-density="compact"]) .machine {
    padding: 16px 16px 0;
  }
  :global([data-density="compact"]) .description {
    margin-bottom: 16px;
  }
  :global([data-density="compact"]) footer {
    padding: 10px 0;
  }
  :global([data-density="compact"]) .network {
    padding: 12px 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .machine {
      transition: none;
    }
    .machine:hover {
      transform: none;
    }
  }
</style>
