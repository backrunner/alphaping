<script lang="ts">
  import {
    ArrowRight,
    Box,
    ChevronDown,
    ChevronUp,
    Cpu,
    HardDrive,
    MemoryStick,
    Network,
  } from "lucide-svelte";
  import type { PublicStatusMachine } from "@alphaping/db";

  import StatusLabel from "$components/status/status-label.svelte";
  import { formatBytes, formatPercent, formatRate, formatRelativeTime } from "$lib/utils/format";

  let {
    machines,
    workspaceSlug,
  }: { machines: readonly PublicStatusMachine[]; workspaceSlug: string } = $props();
  const previewSize = 25;
  let expanded = $state(false);
  const visibleMachines = $derived(expanded ? machines : machines.slice(0, previewSize));
</script>

{#if machines.length > 0}
  <section aria-labelledby="public-machines-title">
    <header>
      <div>
        <h2 id="public-machines-title">Infrastructure</h2>
        <p>{machines.length} published machines</p>
      </div>
      <a href={`/status/${workspaceSlug}/machines`}>View all machines<ArrowRight size={13} /></a>
    </header>
    <div class="machine-list">
      {#each visibleMachines as machine}
        <article>
          <div class="machine-main">
            <div class="machine-name">
              <a href={`/status/${workspaceSlug}/machines/${machine.slug}`}
                ><strong>{machine.name}</strong></a
              >{#if machine.description}<span>{machine.description}</span>{/if}
            </div>
            <StatusLabel status={machine.state} />
            <span class="observed">{formatRelativeTime(machine.observedAt)}</span>
          </div>
          {#if machine.cpuPermille !== null}
            <div class="metrics">
              <span
                ><Cpu size={12} /><small>CPU</small><strong
                  >{formatPercent(machine.cpuPermille)}</strong
                ></span
              >
              <span
                ><MemoryStick size={12} /><small>Memory</small><strong
                  >{formatBytes(machine.memoryUsedBytes ?? 0)} / {formatBytes(
                    machine.memoryTotalBytes ?? 0,
                  )}</strong
                ></span
              >
              <span
                ><HardDrive size={12} /><small>Storage</small><strong
                  >{formatBytes(machine.storageUsedBytes ?? 0)} / {formatBytes(
                    machine.storageTotalBytes ?? 0,
                  )}</strong
                ></span
              >
              <span
                ><Network size={12} /><small>Down / up</small><strong
                  >{formatRate(machine.networkRxBps ?? 0)} / {formatRate(
                    machine.networkTxBps ?? 0,
                  )}</strong
                ></span
              >
            </div>
          {/if}
          {#if machine.containers.length > 0}
            <div class="containers" aria-label={`Published containers on ${machine.name}`}>
              {#each machine.containers as container}
                <span
                  ><Box size={11} /><strong>{container.name}</strong><small
                    >{container.state}{container.health !== "none"
                      ? ` · ${container.health}`
                      : ""}</small
                  >{#if container.cpuPermille !== null}<em
                      >{formatPercent(container.cpuPermille)} · {formatBytes(
                        container.memoryUsedBytes ?? 0,
                      )}</em
                    >{/if}</span
                >
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </div>
    {#if machines.length > previewSize}
      <button
        class="machine-toggle"
        type="button"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        {#if expanded}<ChevronUp size={13} />Show first {previewSize}{:else}<ChevronDown
            size={13}
          />Show all {machines.length} machines{/if}
      </button>
    {/if}
  </section>
{/if}

<style>
  section {
    margin-top: 26px;
  }

  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  header a {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 5px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 650;
    text-decoration: none;
  }

  header a:hover {
    color: var(--accent-hover);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
  }

  p {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .machine-list {
    border-top: 1px solid var(--border);
  }

  .machine-toggle {
    display: inline-flex;
    height: 30px;
    align-items: center;
    gap: 5px;
    margin-top: 9px;
    padding: 0;
    border: 0;
    color: var(--accent);
    background: transparent;
    font: inherit;
    font-size: 10px;
    font-weight: 650;
    cursor: pointer;
  }

  article {
    padding: 11px 0;
    border-bottom: 1px solid var(--border);
  }

  .machine-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 64px;
    align-items: center;
    gap: 10px;
  }

  .machine-name strong,
  .machine-name span {
    display: block;
  }

  .machine-name strong {
    font-size: 12px;
  }

  .machine-name span,
  .observed {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 9px;
  }

  .observed {
    text-align: right;
  }

  .metrics {
    display: grid;
    grid-template-columns: 0.7fr 1.2fr 1.2fr 1.5fr;
    gap: 12px;
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid var(--surface-strong);
  }

  .metrics > span {
    display: grid;
    grid-template-columns: 14px 1fr;
    align-items: center;
    column-gap: 4px;
  }

  .metrics :global(svg) {
    color: var(--text-faint);
  }

  .metrics small {
    color: var(--text-muted);
    font-size: 9px;
  }

  .metrics strong {
    grid-column: 2;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
  }

  .containers {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 9px;
  }

  .containers > span {
    display: inline-flex;
    height: 24px;
    align-items: center;
    gap: 5px;
    padding: 0 7px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-subtle);
    font-size: 9px;
  }

  .containers strong {
    color: var(--text);
  }

  .containers small,
  .containers em {
    font-size: 9px;
    font-style: normal;
  }

  .containers em {
    font-family: var(--font-mono);
  }

  @media (max-width: 680px) {
    .metrics {
      grid-template-columns: 1fr 1fr;
    }

    .machine-main {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .observed {
      grid-column: 1 / -1;
      text-align: left;
    }
  }
</style>
