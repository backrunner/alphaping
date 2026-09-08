<script lang="ts">
  import { ArrowDown, ArrowUp, Box, Cpu, HardDrive, MemoryStick } from "@lucide/svelte";
  import type { DashboardMachine } from "@alphaping/db";

  import StatusLabel from "$components/status/status-label.svelte";
  import { formatBytes, formatPercent, formatRate, formatRelativeTime } from "$lib/utils/format";

  let { machine, workspaceSlug }: { machine: DashboardMachine; workspaceSlug: string } = $props();
  const labels = $derived(Object.entries(machine.labels).slice(0, 2));
</script>

<a
  class="machine"
  href={`/${workspaceSlug}/machines/${machine.id}`}
  aria-label={`Open ${machine.name} machine details`}
>
  <header class="machine__header">
    <div class="machine__identity">
      <span class="machine__name">{machine.name}</span>
      <span class="machine__meta">
        {machine.platform ?? "Unregistered"}
        {#if machine.arch}
          / {machine.arch}{/if}
        {#if machine.agentVersion}
          · Agent {machine.agentVersion}{/if}
      </span>
      <span class="machine__labels" aria-label="Machine labels">
        {#each labels as label}
          <span title={`${label[0]}=${label[1]}`}>{label[0]}={label[1]}</span>
        {/each}
      </span>
    </div>
    <StatusLabel status={machine.state} />
  </header>

  <div class="machine__metrics">
    <div class="machine__metric">
      <Cpu size={14} />
      <span>CPU</span>
      <strong>{formatPercent(machine.cpuPermille)}</strong>
    </div>
    <div class="machine__metric">
      <MemoryStick size={14} />
      <span>Memory</span>
      <strong>{formatBytes(machine.memoryUsedBytes)}</strong>
      <small>/ {formatBytes(machine.memoryTotalBytes)}</small>
    </div>
    <div class="machine__metric">
      <HardDrive size={14} />
      <span>Storage</span>
      <strong>{formatBytes(machine.storageUsedBytes)}</strong>
      <small>/ {formatBytes(machine.storageTotalBytes)}</small>
    </div>
  </div>

  <footer class="machine__footer">
    <div class="machine__network" aria-label="Current network throughput">
      <span><ArrowDown size={13} /> {formatRate(machine.networkRxBps)}</span>
      <span><ArrowUp size={13} /> {formatRate(machine.networkTxBps)}</span>
      <small>
        Total {formatBytes(machine.networkRxTotal)} down / {formatBytes(machine.networkTxTotal)} up
      </small>
    </div>
    <div class="machine__last-seen">
      {#if machine.containersEnabled}<Box
          size={13}
          aria-label="Container monitoring enabled"
        />{/if}
      <time>{formatRelativeTime(machine.observedAt)}</time>
    </div>
  </footer>
</a>

<style>
  .machine {
    display: block;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    color: inherit;
    background: var(--surface);
    box-shadow: var(--shadow-card);
    text-decoration: none;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease,
      translate 140ms ease;
  }

  .machine:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-card-hover);
    translate: 0 -1px;
  }

  .machine:focus-visible {
    outline-offset: 3px;
  }

  .machine__header,
  .machine__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
  }

  .machine__identity {
    min-width: 0;
    flex: 1;
  }

  .machine__name {
    display: block;
    overflow: hidden;
    color: var(--text);
    font-size: 14px;
    font-weight: 650;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine:hover .machine__name {
    color: var(--accent);
  }

  .machine__meta {
    display: block;
    margin-top: 2px;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine__labels {
    display: flex;
    min-height: 16px;
    gap: 4px;
    margin-top: 4px;
    overflow: hidden;
  }

  .machine__labels span {
    max-width: 130px;
    overflow: hidden;
    padding: 1px 5px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-subtle);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine__metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-block: 1px solid var(--border);
  }

  .machine__metric {
    display: grid;
    min-width: 0;
    grid-template-columns: 16px 1fr;
    gap: 3px 5px;
    padding: 9px 10px;
    color: var(--text-faint);
  }

  .machine__metric + .machine__metric {
    border-left: 1px solid var(--border);
  }

  .machine__metric span {
    overflow: hidden;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine__metric strong {
    grid-column: 1 / -1;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  .machine__metric small {
    grid-column: 1 / -1;
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine__footer {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .machine__network,
  .machine__last-seen,
  .machine__network span {
    display: flex;
    align-items: center;
  }

  .machine__network {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(2, max-content);
    gap: 2px 10px;
  }

  .machine__network span {
    gap: 3px;
    white-space: nowrap;
  }

  .machine__network small {
    grid-column: 1 / -1;
    color: var(--text-faint);
    font-size: 10px;
    white-space: nowrap;
  }

  .machine__last-seen {
    flex: none;
    gap: 5px;
    color: var(--text-faint);
  }

  @media (max-width: 420px) {
    .machine__footer {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .machine {
      transition: none;
    }
  }
</style>
