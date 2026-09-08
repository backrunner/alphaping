<script lang="ts">
  import type { MachineDetail } from "@alphaping/db";
  import { Boxes, Clock3 } from "@lucide/svelte";

  import ContainerList from "$components/machines/container-list.svelte";
  import ContainerRuntimeList from "$components/machines/container-runtime-list.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";
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
  <EmptyState
    compact
    icon={Clock3}
    title="Awaiting container inventory"
    description="The Agent will report detected runtimes with its next durable report."
  />
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
      <h2 id="container-heading">Containers</h2>
    </header>
    {#if inventory.containers.length === 0}
      <EmptyState
        compact
        icon={Boxes}
        title="No containers detected"
        description="Available runtimes are connected and currently reporting an empty inventory."
      />
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

  .container-section h2 {
    color: var(--text);
    font-size: var(--text-base);
    font-weight: 600;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(88px, 140px)) minmax(0, 1fr);
    align-items: center;
    border-block: 1px solid var(--border);
  }

  .summary > div {
    padding: var(--space-2) var(--space-3);
    border-right: 1px solid var(--border);
  }

  .summary span,
  .summary strong {
    display: block;
  }

  .summary span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .summary strong {
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .summary strong.problem {
    color: var(--status-down);
  }

  .summary p {
    justify-self: end;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .summary time {
    display: block;
    margin-top: 2px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .container-section {
    padding-top: var(--space-6);
  }

  .container-section > header {
    margin-bottom: var(--space-3);
  }

  @media (max-width: 820px) {
    .summary {
      grid-template-columns: repeat(3, 1fr);
    }

    .summary p {
      grid-column: 1 / -1;
      justify-self: start;
      padding: var(--space-2) var(--space-3);
      border-top: 1px solid var(--border);
    }
  }
</style>
