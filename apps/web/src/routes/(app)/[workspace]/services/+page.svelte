<script lang="ts">
  import { page } from "$app/state";
  import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Plus,
    Search,
    SquareActivity,
  } from "@lucide/svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import ServiceMonitorTable from "$components/services/service-monitor-table.svelte";
  import Button from "$components/ui/button/button.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";

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
    <EmptyState
      icon={SquareActivity}
      title="No services available"
      description="No service has been configured or granted to this account."
    />
  {/if}
</main>

<style>
  main {
    width: min(100% - 24px, var(--content-wide));
    margin: 0 auto;
    padding: var(--space-6) 0 var(--space-8);
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .page-header a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  .page-header a:hover {
    color: var(--accent);
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    margin-top: var(--space-2);
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }

  .page-header p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }

  .toolbar > span {
    margin-left: auto;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .search {
    display: flex;
    width: min(260px, 100%);
    height: 32px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text-faint);
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    color: var(--text);
    background: transparent;
    font: inherit;
    font-size: var(--text-sm);
  }

  .search input::placeholder {
    color: var(--text-faint);
  }

  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .search button {
    height: 22px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: var(--surface-subtle);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .search button:hover {
    color: var(--text);
    background: var(--surface-strong);
  }

  .segments {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-pill);
    background: var(--surface-subtle);
  }

  .segments a {
    display: inline-flex;
    height: 26px;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-decoration: none;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .segments a:hover {
    color: var(--text);
  }

  .segments a.active {
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border);
    font-weight: 620;
  }

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: var(--space-4);
    font-size: var(--text-xs);
  }

  .pagination a,
  .pagination span {
    display: inline-flex;
    height: 32px;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
  }

  .pagination a {
    color: var(--text);
    background: var(--surface);
    text-decoration: none;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .pagination a:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .pagination span {
    color: var(--text-faint);
  }

  .pagination a:last-child,
  .pagination span:last-child {
    justify-self: end;
  }

  .pagination strong {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 680px) {
    .toolbar {
      align-items: stretch;
    }

    .search {
      width: 100%;
    }

    .segments {
      overflow-x: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .search,
    .search button,
    .segments a,
    .pagination a {
      transition: none;
    }
  }
</style>
