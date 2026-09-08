<script lang="ts">
  import type { MachineContainer, MachineContainerInventory } from "@alphaping/db";
  import {
    Box,
    CheckCircle2,
    CircleHelp,
    PauseCircle,
    TriangleAlert,
    XCircle,
  } from "@lucide/svelte";

  import { formatBytes, formatPercent, formatRate } from "$lib/utils/format";

  let { containers }: { containers: MachineContainerInventory["containers"] } = $props();

  const runtimeNames = {
    docker: "Docker Engine",
    "colima-docker": "Colima Docker",
    "colima-containerd": "Colima containerd",
    "apple-container": "Apple container",
    unknown: "Unknown runtime",
  } as const;

  const stateLabels = {
    created: "Created",
    running: "Running",
    paused: "Paused",
    restarting: "Restarting",
    exited: "Exited",
    dead: "Dead",
    unknown: "Unknown",
  } as const;

  function portSummary(ports: MachineContainer["ports"]): string {
    if (ports.length === 0) return "No published ports";
    return ports
      .slice(0, 3)
      .map((port) =>
        port.publicPort > 0
          ? `${port.publicPort}:${port.privatePort}/${port.protocol}`
          : `${port.privatePort}/${port.protocol}`,
      )
      .join(", ");
  }
</script>

<div class="container-list" role="list">
  {#each containers as container (container.id)}
    <article role="listitem">
      <div class="identity">
        <Box size={15} />
        <span>
          <strong>{container.name || "Unnamed container"}</strong>
          <small title={container.image}>{container.image || "Image unavailable"}</small>
        </span>
      </div>
      <div class={`state state-${container.state}`}>
        {#if container.state === "running"}
          <CheckCircle2 size={12} />
        {:else if container.state === "paused"}
          <PauseCircle size={12} />
        {:else if container.state === "dead" || container.health === "unhealthy"}
          <XCircle size={12} />
        {:else if container.state === "restarting"}
          <TriangleAlert size={12} />
        {:else}
          <CircleHelp size={12} />
        {/if}
        {stateLabels[container.state]}
        {#if container.health !== "none" && container.health !== "unknown"}
          <span>({container.health})</span>
        {/if}
      </div>
      <dl class="metrics">
        <div>
          <dt>CPU</dt>
          <dd>{formatPercent(container.cpuPermille)}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>
            {formatBytes(container.memoryUsedBytes)}
            <small>of {formatBytes(container.memoryLimitBytes)}</small>
          </dd>
        </div>
        <div>
          <dt>Download</dt>
          <dd>{formatRate(container.networkRxBps)}</dd>
        </div>
        <div>
          <dt>Upload</dt>
          <dd>{formatRate(container.networkTxBps)}</dd>
        </div>
      </dl>
      <div class="meta">
        <span>{runtimeNames[container.runtime]} / {container.runtimeInstance}</span>
        <span>{container.restartCount} restarts</span>
        <span title={portSummary(container.ports)}>{portSummary(container.ports)}</span>
      </div>
    </article>
  {/each}
</div>

<style>
  .container-list {
    border-block: 1px solid var(--border);
  }

  article {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(180px, 1.15fr) minmax(105px, 0.6fr) minmax(320px, 1.8fr);
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  article + article {
    border-top: 1px solid var(--border);
  }

  .identity {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
  }

  .identity > span {
    min-width: 0;
  }

  .identity strong,
  .identity small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity strong {
    font-size: var(--text-base);
  }

  .identity small {
    margin-top: 2px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .state {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--status-offline);
    background: var(--status-offline-bg);
    font-size: var(--text-xs);
  }

  .state-running {
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }

  .state-dead,
  .state-restarting {
    color: var(--status-down);
    background: var(--status-down-bg);
  }

  .state-paused {
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
  }

  .metrics > div {
    min-width: 0;
    padding: 0 var(--space-2);
    border-left: 1px solid var(--border);
  }

  .metrics dt,
  .metrics dd {
    margin: 0;
  }

  .metrics dt,
  .metrics small {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .metrics dd {
    margin-top: 2px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metrics small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    min-width: 0;
    grid-column: 1 / -1;
    gap: var(--space-3);
    padding-left: 23px;
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .meta span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 820px) {
    article {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .metrics {
      grid-column: 1 / -1;
    }

    .metrics > div:first-child {
      border-left: 0;
    }

    .meta {
      padding-left: 0;
    }
  }

  @media (max-width: 520px) {
    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: var(--space-3);
    }

    .metrics > div:nth-child(odd) {
      border-left: 0;
    }

    .meta {
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
    }
  }
</style>
