<script lang="ts">
  import type { MachineDetail } from "@alphaping/db";
  import { Boxes, Clock3 } from "lucide-svelte";

  import ContainerList from "$components/machines/container-list.svelte";
  import ContainerRuntimeList from "$components/machines/container-runtime-list.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { inventory }: { inventory: MachineDetail["containerInventory"] } = $props();

  const runningCount = $derived(
    inventory?.containers.filter((container) => container.state === "running").length ?? 0,
  );
  const problemCount = $derived(
    inventory?.containers.filter(
      (container) =>
        container.state === "dead" ||
        container.state === "restarting" ||
        container.health === "unhealthy",
    ).length ?? 0,
  );
</script>

{#if !inventory}
  <div class="awaiting" role="status">
    <Clock3 size={20} />
    <div>
      <h2>Awaiting container inventory</h2>
      <p>The Agent will report detected runtimes with its next durable report.</p>
    </div>
  </div>
{:else}
  <section class="summary" aria-label="Container inventory summary">
    <div><span>Containers</span><strong>{inventory.containers.length}</strong></div>
    <div><span>Running</span><strong>{runningCount}</strong></div>
    <div><span>Problems</span><strong class:problem={problemCount > 0}>{problemCount}</strong></div>
    <p>
      Collected {formatRelativeTime(inventory.observedAt)}
      <time datetime={new Date(inventory.observedAt).toISOString()}
        >{new Date(inventory.observedAt).toLocaleString()}</time
      >
    </p>
  </section>

  <ContainerRuntimeList runtimes={inventory.runtimes} />

  <section class="container-section" aria-labelledby="container-heading">
    <header>
      <div>
        <h2 id="container-heading">Containers</h2>
        <p>Current state and resource usage</p>
      </div>
    </header>
    {#if inventory.containers.length === 0}
      <div class="empty">
        <Boxes size={20} />
        <strong>No containers detected</strong>
        <span>Available runtimes are reporting an empty inventory.</span>
      </div>
    {:else}
      <ContainerList containers={inventory.containers} />
    {/if}
  </section>
{/if}

<style>
  h2,
  p {
    margin: 0;
  }

  .awaiting {
    display: flex;
    min-height: 240px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-faint);
  }

  .awaiting h2,
  .container-section h2 {
    color: var(--text);
    font-size: 14px;
  }

  .awaiting p,
  header p {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(88px, 140px)) minmax(0, 1fr);
    align-items: center;
    border-block: 1px solid var(--border);
  }

  .summary > div {
    padding: 9px 12px;
    border-right: 1px solid var(--border);
  }

  .summary span,
  .summary strong {
    display: block;
  }

  .summary span {
    color: var(--text-faint);
    font-size: 9px;
  }

  .summary strong {
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .summary strong.problem {
    color: var(--status-down);
  }

  .summary p {
    justify-self: end;
    color: var(--text-muted);
    font-size: 10px;
  }

  .summary time {
    display: block;
    margin-top: 2px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 9px;
  }

  .container-section {
    padding-top: 20px;
  }

  .container-section > header {
    margin-bottom: 10px;
  }

  .empty {
    display: grid;
    min-height: 160px;
    place-content: center;
    justify-items: center;
    gap: 5px;
    border-block: 1px solid var(--border);
    color: var(--text-faint);
  }

  .empty strong {
    color: var(--text);
    font-size: 11px;
  }

  .empty span {
    font-size: 9px;
  }

  @media (max-width: 820px) {
    .summary {
      grid-template-columns: repeat(3, 1fr);
    }

    .summary p {
      grid-column: 1 / -1;
      justify-self: start;
      padding: 8px 12px;
      border-top: 1px solid var(--border);
    }
  }
</style>
