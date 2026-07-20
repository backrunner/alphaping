<script lang="ts">
  import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    Box,
    Cpu,
    HardDrive,
    MemoryStick,
    Radio,
  } from "lucide-svelte";
  import type { PublicStatusMachine } from "@alphaping/db";

  import StatusLabel from "$components/status/status-label.svelte";
  import { formatBytes, formatPercent, formatRate, formatRelativeTime } from "$lib/utils/format";

  let { machine, workspaceSlug }: { machine: PublicStatusMachine; workspaceSlug: string } =
    $props();
</script>

<a
  class="machine"
  href={`/status/${workspaceSlug}/machines/${machine.slug}`}
  aria-label={`Open ${machine.name} machine status`}
>
  <header>
    <div class="identity">
      <strong>{machine.name}</strong>
      <span>{machine.description || "Published machine status"}</span>
    </div>
    <StatusLabel status={machine.state} />
  </header>

  {#if machine.cpuPermille !== null}
    <div class="metrics">
      <div>
        <span><Cpu size={14} />CPU</span>
        <strong>{formatPercent(machine.cpuPermille)}</strong>
      </div>
      <div>
        <span><MemoryStick size={14} />Memory</span>
        <strong>{formatBytes(machine.memoryUsedBytes ?? 0)}</strong>
        <small>/ {formatBytes(machine.memoryTotalBytes ?? 0)}</small>
      </div>
      <div>
        <span><HardDrive size={14} />Storage</span>
        <strong>{formatBytes(machine.storageUsedBytes ?? 0)}</strong>
        <small>/ {formatBytes(machine.storageTotalBytes ?? 0)}</small>
      </div>
      <div>
        <span><ArrowDown size={14} />Down <ArrowUp size={14} />Up</span>
        <strong>{formatRate(machine.networkRxBps ?? 0)}</strong>
        <small>/ {formatRate(machine.networkTxBps ?? 0)}</small>
      </div>
    </div>
  {:else}
    <div class="summary-only">
      <Radio size={15} />
      <span>Resource metrics are not published</span>
    </div>
  {/if}

  <footer>
    <span class="observed">Updated {formatRelativeTime(machine.observedAt)}</span>
    <span class="meta">
      {#if machine.containers.length > 0}
        <span><Box size={13} />{machine.containers.length} published</span>
      {/if}
      <ArrowRight class="arrow" size={15} aria-hidden="true" />
    </span>
  </footer>
</a>

<style>
  .machine {
    display: grid;
    min-width: 0;
    overflow: hidden;
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

  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
  }

  .identity {
    min-width: 0;
  }

  .identity strong,
  .identity span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity strong {
    color: var(--text);
    font-size: 14px;
    font-weight: 680;
  }

  .machine:hover .identity strong {
    color: var(--accent);
  }

  .identity span {
    min-height: 17px;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 1px solid var(--border);
  }

  .metrics > div {
    min-width: 0;
    padding: 10px 12px;
  }

  .metrics > div + div {
    border-left: 1px solid var(--border);
  }

  .metrics span {
    display: flex;
    min-height: 16px;
    align-items: center;
    gap: 5px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metrics strong,
  .metrics small {
    display: inline-block;
    margin-top: 6px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metrics small {
    margin-left: 3px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .summary-only {
    display: flex;
    min-height: 56px;
    align-items: center;
    gap: 7px;
    padding: 10px 14px;
    border-block: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--surface-subtle);
    font-size: 12px;
  }

  footer {
    color: var(--text-faint);
    font-size: 11px;
  }

  .meta,
  .meta > span {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .meta {
    flex: none;
    gap: 10px;
  }

  :global(.arrow) {
    transition: translate 140ms ease;
  }

  .machine:hover :global(.arrow) {
    translate: 2px 0;
  }

  @media (max-width: 560px) {
    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metrics > div:nth-child(3) {
      border-left: 0;
    }

    .metrics > div:nth-child(n + 3) {
      border-top: 1px solid var(--border);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .machine,
    :global(.arrow) {
      transition: none;
    }
  }
</style>
