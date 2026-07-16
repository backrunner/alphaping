<script lang="ts">
  import { ArrowLeft, Plus, Search, SquareActivity } from "lucide-svelte";

  import ServiceMonitorTable from "$components/services/service-monitor-table.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data } = $props();
  let query = $state("");
  let status = $state<"all" | "healthy" | "impaired" | "maintenance" | "unknown">("all");

  const filtered = $derived(
    data.services.filter((service) => {
      const matchesName = service.name.toLowerCase().includes(query.trim().toLowerCase());
      const matchesState =
        status === "all" ||
        service.state === status ||
        (status === "impaired" && (service.state === "degraded" || service.state === "down"));
      return matchesName && matchesState;
    }),
  );
</script>

<svelte:head><title>Services · {data.workspace.name}</title></svelte:head>

<main>
  <header class="page-header">
    <div>
      <a href={`/${data.workspace.slug}`}><ArrowLeft size={14} />Overview</a>
      <h1>Services</h1>
      <p>{data.services.length} monitored services</p>
    </div>
    {#if data.workspace.role === "admin"}
      <Button
        onclick={() => (window.location.href = `/${data.workspace.slug}/admin#service-monitor`)}
      >
        <Plus size={14} />Add service
      </Button>
    {/if}
  </header>

  {#if data.services.length > 0}
    <div class="toolbar">
      <label class="search">
        <Search size={14} /><input
          bind:value={query}
          aria-label="Search services"
          placeholder="Search services"
        />
      </label>
      <div class="segments" aria-label="Filter service status">
        {#each [["all", "All"], ["healthy", "Healthy"], ["impaired", "Impaired"], ["maintenance", "Maintenance"], ["unknown", "Unknown"]] as option}
          <button
            class:active={status === option[0]}
            aria-pressed={status === option[0]}
            onclick={() => (status = option[0] as typeof status)}>{option[1]}</button
          >
        {/each}
      </div>
      <span>{filtered.length} shown</span>
    </div>
    <ServiceMonitorTable services={filtered} workspaceSlug={data.workspace.slug} />
  {:else}
    <section class="empty">
      <SquareActivity size={26} />
      <h2>No services available</h2>
      <p>No service has been configured or granted to this account.</p>
    </section>
  {/if}
</main>

<style>
  main {
    width: min(100% - 24px, 1220px);
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

  .toolbar > span {
    margin-left: auto;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .search {
    display: flex;
    width: min(300px, 40vw);
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

  .empty h2 {
    color: var(--text);
    font-size: 14px;
  }

  @media (max-width: 680px) {
    .toolbar {
      align-items: stretch;
      flex-wrap: wrap;
      padding: 12px 0;
    }

    .search {
      width: 100%;
    }

    .segments {
      overflow-x: auto;
    }
  }
</style>
