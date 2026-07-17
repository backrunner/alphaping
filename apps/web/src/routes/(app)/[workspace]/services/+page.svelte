<script lang="ts">
  import { page } from "$app/state";
  import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Plus,
    Search,
    SquareActivity,
  } from "lucide-svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import ServiceMonitorTable from "$components/services/service-monitor-table.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data } = $props();
  const pageSize = 100;
  const statusOptions = [
    "all",
    "healthy",
    "degraded",
    "down",
    "impaired",
    "maintenance",
    "unknown",
  ] as const;
  const statusFilters = [
    ["all", "All"],
    ["healthy", "Healthy"],
    ["impaired", "Impaired"],
    ["down", "Down"],
    ["maintenance", "Maintenance"],
    ["unknown", "Unknown"],
  ] as const;
  type StatusFilter = (typeof statusOptions)[number];

  function filterHref(name: string, value: string): string {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    if (value === "" || value === "all") params.delete(name);
    else params.set(name, value);
    params.delete("page");
    const query = params.toString();
    return `${page.url.pathname}${query ? `?${query}` : ""}`;
  }

  function paginationHref(value: number): string {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    if (value <= 1) params.delete("page");
    else params.set("page", String(value));
    const query = params.toString();
    return `${page.url.pathname}${query ? `?${query}` : ""}`;
  }

  const queryValue = $derived(page.url.searchParams.get("q")?.trim() ?? "");
  const query = $derived(queryValue.toLowerCase());
  const status = $derived.by<StatusFilter>(() => {
    const value = page.url.searchParams.get("status");
    return statusOptions.includes(value as StatusFilter) ? (value as StatusFilter) : "all";
  });
  const filtered = $derived.by(() =>
    data.services.filter((service) => {
      const matchesName = service.name.toLowerCase().includes(query);
      const matchesState =
        status === "all" ||
        service.state === status ||
        (status === "impaired" && (service.state === "degraded" || service.state === "down"));
      return matchesName && matchesState;
    }),
  );
  const requestedPage = $derived(Number(page.url.searchParams.get("page") ?? "1"));
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
  const currentPage = $derived(
    Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pageCount) : 1,
  );
  const visibleServices = $derived(
    filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
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
      <form class="search" method="GET">
        {#if status !== "all"}<input type="hidden" name="status" value={status} />{/if}
        <Search size={14} /><input
          name="q"
          value={queryValue}
          aria-label="Search services"
          placeholder="Search services"
        />
        <button type="submit">Search</button>
      </form>
      <nav class="segments" aria-label="Filter service status">
        {#each statusFilters as option}
          <a
            class:active={status === option[0]}
            aria-current={status === option[0] ? "page" : undefined}
            href={filterHref("status", option[0])}>{option[1]}</a
          >
        {/each}
      </nav>
      <span>
        {visibleServices.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}-{Math.min(
          currentPage * pageSize,
          filtered.length,
        )} of {filtered.length}
      </span>
    </div>
    <ServiceMonitorTable services={visibleServices} workspaceSlug={data.workspace.slug} />
    {#if pageCount > 1}
      <nav class="pagination" aria-label="Service pages">
        {#if currentPage > 1}
          <a href={paginationHref(currentPage - 1)}><ChevronLeft size={14} />Previous</a>
        {:else}<span><ChevronLeft size={14} />Previous</span>{/if}
        <strong>Page {currentPage} of {pageCount}</strong>
        {#if currentPage < pageCount}
          <a href={paginationHref(currentPage + 1)}>Next<ChevronRight size={14} /></a>
        {:else}<span>Next<ChevronRight size={14} /></span>{/if}
      </nav>
    {/if}
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

  .search button {
    height: 22px;
    padding: 0 7px;
    border: 0;
    border-radius: 4px;
    color: var(--text-muted);
    background: var(--surface-subtle);
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  .segments {
    display: flex;
    gap: 2px;
  }

  .segments a {
    display: inline-flex;
    height: 28px;
    align-items: center;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    font-size: 10px;
    text-decoration: none;
  }

  .segments a.active {
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

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: 16px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .pagination a,
  .pagination span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .pagination a {
    color: var(--accent);
    text-decoration: none;
  }

  .pagination a:last-child,
  .pagination span:last-child {
    justify-self: end;
  }

  .pagination strong {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-weight: 500;
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
