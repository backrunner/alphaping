<script lang="ts">
  import { RotateCcw, Trash2 } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";

  let {
    resources,
    result,
  }: {
    resources: readonly {
      type: "machine" | "service";
      id: string;
      name: string;
      deletedAt: number;
    }[];
    result: Record<string, unknown> | null;
  } = $props();

  function formatUtc(timestamp: number): string {
    return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
</script>

{#if resources.length > 0 || result?.kind === "restore"}
  <section class="deleted">
    <header>
      <Trash2 size={17} />
      <div>
        <h2>Recently deleted</h2>
        <p>Resources remain recoverable until the workspace retention window closes.</p>
      </div>
    </header>
    {#if result?.kind === "restore" && result.message}
      <p class="feedback feedback--error" role="alert">{String(result.message)}</p>
    {:else if result?.kind === "restore" && result.restored}
      <p class="feedback" role="status">Resource restored.</p>
    {/if}
    <div class="rows">
      {#each resources as resource (`${resource.type}:${resource.id}`)}
        <div class="row">
          <span>{resource.type}</span>
          <strong>{resource.name}</strong>
          <time datetime={new Date(resource.deletedAt).toISOString()}
            >Deleted {formatUtc(resource.deletedAt)}</time
          >
          <form method="POST" action="?/restoreResource">
            <input type="hidden" name="resourceType" value={resource.type} />
            <input type="hidden" name="resourceId" value={resource.id} />
            <Button type="submit" variant="secondary"><RotateCcw size={13} />Restore</Button>
          </form>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .deleted {
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }

  header,
  .row {
    display: flex;
    align-items: center;
  }

  header {
    align-items: flex-start;
    gap: 9px;
    margin-bottom: 12px;
  }

  header > :global(svg) {
    color: var(--text-faint);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
  }

  header p,
  time {
    color: var(--text-muted);
    font-size: 10px;
  }

  .rows {
    border-block: 1px solid var(--border);
  }

  .row {
    min-height: 46px;
    gap: 12px;
    border-top: 1px solid var(--border);
  }

  .row:first-child {
    border-top: 0;
  }

  .row > span {
    width: 56px;
    color: var(--text-faint);
    font-size: 9px;
    text-transform: uppercase;
  }

  .row strong {
    min-width: 0;
    overflow: hidden;
    flex: 1;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row time {
    font-family: var(--font-mono);
  }

  .feedback {
    margin-bottom: 8px;
    color: var(--status-healthy);
    font-size: 10px;
  }

  .feedback--error {
    color: var(--status-down);
  }

  @media (max-width: 620px) {
    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 4px 9px;
      padding-block: 8px;
    }

    .row > span {
      width: auto;
    }

    .row time {
      grid-column: 1 / 3;
      grid-row: 2;
    }

    .row form {
      grid-column: 3;
      grid-row: 1 / span 2;
    }
  }
</style>
