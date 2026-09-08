<script lang="ts">
  type Event = {
    occurredAt: number;
    previousState: string;
    currentState: string;
    reasonCode: string;
  };
  let { events }: { events: readonly Event[] } = $props();
</script>

<section>
  <header>
    <div>
      <h2>Status events</h2>
      <span>Immutable transitions</span>
    </div>
  </header>
  {#if events.length > 0}
    <ol>
      {#each events as event}<li>
          <span></span>
          <div>
            <strong>{event.previousState} → {event.currentState}</strong><small
              >{event.reasonCode} · {new Date(event.occurredAt).toLocaleString()}</small
            >
          </div>
        </li>{/each}
    </ol>
  {:else}<p>No status transition has been recorded.</p>{/if}
</section>

<style>
  section {
    margin-top: var(--space-6);
  }
  header {
    margin-bottom: var(--space-3);
  }
  header > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: 14px;
    font-weight: 600;
  }
  header span {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    display: flex;
    gap: var(--space-3);
    min-height: 48px;
    padding-bottom: var(--space-3);
  }
  li::before {
    position: absolute;
    top: 10px;
    bottom: -2px;
    left: 4px;
    width: 1px;
    background: var(--border);
    content: "";
  }
  li:last-child::before {
    display: none;
  }
  li > span {
    z-index: 1;
    width: 9px;
    height: 9px;
    margin-top: 4px;
    border: 2px solid var(--surface);
    border-radius: var(--radius-pill);
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  strong,
  small {
    display: block;
  }
  strong {
    font-size: var(--text-sm);
    font-weight: 620;
    text-transform: capitalize;
  }
  small,
  section > p {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
</style>
