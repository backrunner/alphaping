<script lang="ts">
  import { ArrowDown, ArrowUp, Box, Cpu, HardDrive, MemoryStick } from "@lucide/svelte";
  import type { DashboardMachine } from "@alphaping/db";

  import StatusLabel from "$components/status/status-label.svelte";
  import { formatBytes, formatPercent, formatRate, formatRelativeTime } from "$lib/utils/format";

  let { machine, workspaceSlug }: { machine: DashboardMachine; workspaceSlug: string } = $props();
  const hasTelemetry = $derived(machine.observedAt !== null);
  const labels = $derived(Object.entries(machine.labels).slice(0, 2));
  const cpuPercent = $derived(Math.min(100, machine.cpuPermille / 10));
  const memoryPercent = $derived(
    machine.memoryTotalBytes > 0
      ? Math.min(100, (machine.memoryUsedBytes / machine.memoryTotalBytes) * 100)
      : 0,
  );
  const storagePercent = $derived(
    machine.storageTotalBytes > 0
      ? Math.min(100, (machine.storageUsedBytes / machine.storageTotalBytes) * 100)
      : 0,
  );
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
      <strong>{hasTelemetry ? formatPercent(machine.cpuPermille) : "—"}</strong>
      <span class="machine__bar" aria-hidden="true"
        ><span style={`width: ${cpuPercent}%`}></span></span
      >
    </div>
    <div class="machine__metric">
      <MemoryStick size={14} />
      <span>Memory</span>
      <strong>{hasTelemetry ? formatBytes(machine.memoryUsedBytes) : "—"}</strong>
      <small>/ {hasTelemetry ? formatBytes(machine.memoryTotalBytes) : "—"}</small>
      <span class="machine__bar" aria-hidden="true"
        ><span style={`width: ${memoryPercent}%`}></span></span
      >
    </div>
    <div class="machine__metric">
      <HardDrive size={14} />
      <span>Storage</span>
      <strong>{hasTelemetry ? formatBytes(machine.storageUsedBytes) : "—"}</strong>
      <small>/ {hasTelemetry ? formatBytes(machine.storageTotalBytes) : "—"}</small>
      <span class="machine__bar" aria-hidden="true"
        ><span style={`width: ${storagePercent}%`}></span></span
      >
    </div>
  </div>

  <footer class="machine__footer">
    <div class="machine__network" aria-label="Current network throughput">
      <span><ArrowDown size={13} /> {hasTelemetry ? formatRate(machine.networkRxBps) : "—"}</span>
      <span><ArrowUp size={13} /> {hasTelemetry ? formatRate(machine.networkTxBps) : "—"}</span>
      <small>
        {#if hasTelemetry}
          Total {formatBytes(machine.networkRxTotal)} down / {formatBytes(machine.networkTxTotal)} up
        {:else}
          Awaiting first report
        {/if}
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
    display: flex;
    min-width: 0;
    min-height: 184px;
    flex-direction: column;
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
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .machine__identity {
    min-width: 0;
    flex: 1;
  }

  .machine__name {
    display: block;
    overflow: hidden;
    color: var(--text);
    font-size: var(--text-base);
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
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine__labels {
    display: flex;
    min-height: 16px;
    gap: var(--space-1);
    margin-top: var(--space-1);
    overflow: hidden;
  }

  .machine__labels span {
    max-width: 130px;
    overflow: hidden;
    padding: 1px var(--space-1);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
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
    gap: 3px var(--space-1);
    padding: var(--space-2);
    color: var(--text-faint);
  }

  .machine__metric + .machine__metric {
    border-left: 1px solid var(--border);
  }

  .machine__metric span {
    overflow: hidden;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine__metric strong {
    grid-column: 1 / -1;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-variant-numeric: tabular-nums;
  }

  .machine__metric small {
    grid-column: 1 / -1;
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine__bar {
    display: block;
    height: 3px;
    grid-column: 1 / -1;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: var(--surface-strong);
  }

  .machine__bar > span {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--accent);
    transition: width 150ms ease;
  }

  .machine__footer {
    margin-top: auto;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
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
    gap: 2px var(--space-3);
  }

  .machine__network span {
    gap: 3px;
    white-space: nowrap;
  }

  .machine__network small {
    grid-column: 1 / -1;
    color: var(--text-faint);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .machine__last-seen {
    flex: none;
    gap: var(--space-1);
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
