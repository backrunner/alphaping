<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import type { MachineDetail } from "@alphaping/db";

  import EmptyState from "$components/ui/empty-state/empty-state.svelte";

  let { events }: { events: MachineDetail["events"] } = $props();

  function formatTimestamp(value: number) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(value);
  }

  function eventTitle(previousState: string, currentState: string) {
    return previousState === currentState
      ? `State confirmed as ${currentState}`
      : `${previousState} to ${currentState}`;
  }
</script>

<header>
  <div>
    <h2>State events</h2>
    <p>Most recent durable machine state transitions.</p>
  </div>
</header>
{#if events.length > 0}
  <ol>
    {#each events as event}
      <li>
        <span class="marker"><TriangleAlert size={13} /></span>
        <div>
          <strong>{eventTitle(event.previousState, event.currentState)}</strong><small
            >{event.reasonCode}</small
          >
        </div>
        <time>{formatTimestamp(event.occurredAt)}</time>
      </li>
    {/each}
  </ol>
{:else}
  <EmptyState
    compact
    icon={TriangleAlert}
    title="No state changes yet"
    description="Durable machine transitions will appear here after the first health change."
  />
{/if}

<style>
  header {
    margin-bottom: var(--space-3);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: var(--text-base);
    font-weight: 600;
  }

  p {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    min-height: 50px;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-2);
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-button);
    transition: background-color 120ms ease;
  }

  li:hover {
    background: var(--surface-subtle);
  }

  .marker {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: var(--radius-pill);
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
  }

  strong,
  small {
    display: block;
  }

  strong {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  small,
  time {
    margin-top: 2px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  @media (max-width: 520px) {
    li {
      grid-template-columns: 24px minmax(0, 1fr);
      padding-block: var(--space-2);
    }

    time {
      grid-column: 2;
    }
  }
</style>
