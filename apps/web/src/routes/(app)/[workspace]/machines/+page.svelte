<script lang="ts">
  import { ArrowLeft, Plus, Search, Server } from "lucide-svelte";

  import MachineCard from "$components/machines/machine-card.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data } = $props();
  let query = $state("");
  let status = $state<"all" | "online" | "impaired" | "offline" | "unknown">("all");

  const filteredMachines = $derived(
    data.machines.filter((machine) => {
      const matchesQuery = machine.name.toLowerCase().includes(query.trim().toLowerCase());
      const matchesStatus =
        status === "all" ||
        (status === "online" && machine.state === "healthy") ||
        (status === "impaired" && (machine.state === "degraded" || machine.state === "down")) ||
        (status === "offline" && machine.state === "offline") ||
        (status === "unknown" && machine.state === "unknown");
      return matchesQuery && matchesStatus;
    }),
  );
</script>

<svelte:head><title>Machines · {data.workspace.name}</title></svelte:head>

<main class="machines-page">
  <header class="page-header">
    <div>
      <a href={`/${data.workspace.slug}`}><ArrowLeft size={14} />Overview</a>
      <h1>Machines</h1>
      <p>{data.machines.length} monitored resources</p>
    </div>
    {#if data.workspace.role === "admin"}
      <Button onclick={() => (window.location.href = `/${data.workspace.slug}/admin`)}>
        <Plus size={14} />Add machine
      </Button>
    {/if}
  </header>

  {#if data.machines.length > 0}
    <div class="toolbar">
      <label class="search">
        <Search size={14} />
        <input bind:value={query} aria-label="Search machines" placeholder="Search machines" />
      </label>
      <div class="segments" aria-label="Filter machine status">
        {#each [["all", "All"], ["online", "Online"], ["impaired", "Impaired"], ["offline", "Offline"], ["unknown", "Unknown"]] as option}
          <button
            class:active={status === option[0]}
            aria-pressed={status === option[0]}
            onclick={() => (status = option[0] as typeof status)}>{option[1]}</button
          >
        {/each}
      </div>
      <span class="result-count">{filteredMachines.length} shown</span>
    </div>

    {#if filteredMachines.length > 0}
      <section class="machine-grid" aria-label="Machines">
        {#each filteredMachines as machine (machine.id)}
          <MachineCard {machine} workspaceSlug={data.workspace.slug} />
        {/each}
      </section>
    {:else}
      <section class="empty compact">
        <Search size={22} />
        <h2>No matching machines</h2>
        <p>Change the search or status filter.</p>
      </section>
    {/if}
  {:else}
    <section class="empty">
      <Server size={26} />
      <h2>No machines available</h2>
      <p>No machine has been configured or granted to this account.</p>
    </section>
  {/if}
</main>

<style>
  .machines-page {
    width: min(100% - 24px, 1180px);
    margin: 0 auto;
    padding: 24px 0 48px;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }

  .page-header a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: none;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    margin-top: 14px;
    font-size: 22px;
  }

  .page-header p,
  .empty p {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .toolbar {
    display: flex;
    min-height: 54px;
    align-items: center;
    gap: 12px;
  }

  .search {
    display: flex;
    width: min(300px, 42vw);
    height: 30px;
    align-items: center;
    gap: 7px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-faint);
    background: var(--surface);
  }

  .search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    color: var(--text);
    background: transparent;
    font: inherit;
  }

  .segments {
    display: flex;
    gap: 2px;
  }

  .segments button {
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .segments button.active {
    color: var(--text);
    background: var(--surface-strong);
    font-weight: 650;
  }

  .result-count {
    margin-left: auto;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .machine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
    gap: 10px;
  }

  .empty {
    display: grid;
    max-width: 480px;
    justify-items: start;
    gap: 6px;
    margin: 56px auto;
    padding: 28px;
    border: 1px dashed var(--border-strong);
    border-radius: 6px;
    color: var(--text-faint);
    background: var(--surface);
  }

  .empty.compact {
    margin-top: 24px;
  }

  .empty h2 {
    color: var(--text);
    font-size: 14px;
  }

  @media (max-width: 680px) {
    .page-header {
      align-items: flex-start;
    }

    .toolbar {
      align-items: stretch;
      flex-wrap: wrap;
      padding: 12px 0;
    }

    .search {
      width: 100%;
    }

    .result-count {
      display: flex;
      align-items: center;
    }
  }
</style>
