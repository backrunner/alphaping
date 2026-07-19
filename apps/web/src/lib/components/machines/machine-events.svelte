<script lang="ts">
  import { TriangleAlert } from "lucide-svelte";
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
    margin-bottom: 11px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 15px;
  }

  p {
    color: var(--text-muted);
    font-size: 12px;
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
    gap: 8px;
    border-bottom: 1px solid var(--border);
  }

  .marker {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 50%;
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
  }

  strong,
  small {
    display: block;
  }

  strong {
    font-size: 12px;
  }

  small,
  time {
    margin-top: 2px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  @media (max-width: 520px) {
    li {
      grid-template-columns: 24px minmax(0, 1fr);
      padding: 8px 0;
    }

    time {
      grid-column: 2;
    }
  }
</style>
