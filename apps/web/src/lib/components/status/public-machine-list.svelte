<script lang="ts">
  import { ArrowUpRight, Search, Server } from "@lucide/svelte";
  import type { PublicStatusMachine } from "@alphaping/db";
  import PublicMachineCard from "./public-machine-card.svelte";
  let {
    machines,
    workspaceSlug,
  }: { machines: readonly PublicStatusMachine[]; workspaceSlug: string } = $props();
  let query = $state("");
  const filtered = $derived(
    machines.filter((machine) =>
      `${machine.name} ${machine.description}`.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const visible = $derived(filtered.slice(0, 12));
</script>

<section aria-labelledby="public-machines-title">
  <header>
    <div>
      <h2 id="public-machines-title">Machines <span>{machines.length}</span></h2>
    </div>
    <a class="all-link" href={`/status/${workspaceSlug}/machines`}
      >View all<ArrowUpRight size={15} /></a
    >
  </header>
  {#if machines.length > 0}
    <label class="search"
      ><Search size={15} /><input
        type="search"
        aria-label="Find a public machine"
        placeholder="Find a machine…"
        bind:value={query}
      /><span>{filtered.length} found</span></label
    >
    <div class="machine-grid">
      {#each visible as machine (machine.slug)}<PublicMachineCard
          {machine}
          {workspaceSlug}
        />{/each}
    </div>
    {#if filtered.length === 0}<div class="empty">
        <Search size={22} /><strong>No machines match your search</strong><span
          >Try a different name.</span
        ><button type="button" onclick={() => (query = "")}>Clear search</button>
      </div>{/if}
    {#if filtered.length > visible.length}<a
        class="more"
        href={`/status/${workspaceSlug}/machines?q=${encodeURIComponent(query)}`}
        >View all {filtered.length} machines<ArrowUpRight size={15} /></a
      >{/if}
  {:else}<div class="empty">
      <Server size={24} /><strong>No machines shared yet</strong><span
        >Published machines will appear here.</span
      >
    </div>{/if}
</section>

<style>
  section {
    margin: 36px 0;
    scroll-margin-top: 24px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: 22px;
    font-weight: 600;
  }
  h2 span {
    display: grid;
    place-items: center;
    min-width: 28px;
    height: 26px;
    padding: 0 7px;
    background: transparent;
    color: var(--text-faint);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
  }
  .all-link,
  .more {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-size: 12px;
    text-decoration: none;
    min-height: 32px;
  }
  .all-link:hover,
  .more:hover {
    text-decoration: underline;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 0 16px;
    height: 44px;
    margin-bottom: 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text-faint);
    background: var(--surface);
  }
  .search:focus-within {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 13px;
  }
  .search > span {
    font-size: 11px;
  }
  .machine-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 40px 20px;
    border: 1px dashed var(--border-strong);
    border-radius: 18px;
    color: var(--text-muted);
    font-size: 13px;
  }
  .empty strong {
    color: var(--text);
    font-size: 15px;
  }
  .empty button {
    margin-top: 6px;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--accent);
    cursor: pointer;
  }
  .more {
    justify-content: center;
    margin-top: 20px;
  }
  :global([data-density="compact"]) .machine-grid {
    gap: 12px;
  }
  @media (max-width: 1000px) {
    .machine-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 620px) {
    .machine-grid {
      grid-template-columns: 1fr;
      gap: 16px;
    }
    h2 {
      font-size: 22px;
    }
  }
</style>
