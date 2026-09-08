<script lang="ts">
  import ProductAttribution from "$components/layout/product-attribution.svelte";
  import { tick } from "svelte";
  import PublicSurface from "$components/status/public-surface.svelte";
  import PublicNavigation from "$components/status/public-navigation.svelte";
  import { page } from "$app/state";
  import { ArrowLeft, ChevronLeft, ChevronRight, Search, Server } from "@lucide/svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import PublicMachineCard from "$components/status/public-machine-card.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";
  import SelectField from "$components/ui/select/select.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
  const pageSize = 60;
  const statusOptions = [
    "all",
    "healthy",
    "degraded",
    "down",
    "offline",
    "maintenance",
    "unknown",
  ] as const;
  const statusFilters = [
    ["all", "All"],
    ["healthy", "Healthy"],
    ["degraded", "Degraded"],
    ["down", "Down"],
    ["offline", "Offline"],
    ["maintenance", "Maintenance"],
    ["unknown", "Unknown"],
  ] as const;
  const sortOptions = ["priority", "name", "recent"] as const;
  type StatusFilter = (typeof statusOptions)[number];
  type SortOption = (typeof sortOptions)[number];

  function selected<T extends string>(name: string, options: readonly T[], fallback: T): T {
    const value = page.url.searchParams.get(name);
    return options.includes(value as T) ? (value as T) : fallback;
  }

  async function submitFilters(): Promise<void> {
    // Bits UI updates its form value during the next Svelte DOM flush.
    await tick();
    document.querySelector<HTMLFormElement>(".filters")?.requestSubmit();
  }

  function filterHref(name: string, value: string): string {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    if (value === "" || value === "all" || value === "priority") params.delete(name);
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
  const status = $derived(selected<StatusFilter>("status", statusOptions, "all"));
  const sort = $derived(selected<SortOption>("sort", sortOptions, "priority"));
  const filteredMachines = $derived.by(() => {
    const matches = data.machines.filter((machine) => {
      const matchesQuery = `${machine.name} ${machine.description}`.toLowerCase().includes(query);
      const matchesStatus = status === "all" || machine.state === status;
      return matchesQuery && matchesStatus;
    });
    return matches.toSorted((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "recent") return (right.observedAt ?? 0) - (left.observedAt ?? 0);
      const priority = { down: 0, degraded: 1, offline: 2, unknown: 3, maintenance: 4, healthy: 5 };
      return priority[left.state] - priority[right.state] || left.name.localeCompare(right.name);
    });
  });
  const requestedPage = $derived(Number(page.url.searchParams.get("page") ?? "1"));
  const pageCount = $derived(Math.max(1, Math.ceil(filteredMachines.length / pageSize)));
  const currentPage = $derived(
    Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pageCount) : 1,
  );
  const visibleMachines = $derived(
    filteredMachines.slice((currentPage - 1) * pageSize, currentPage * pageSize),
  );
  const stateCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const machine of data.machines) counts[machine.state] = (counts[machine.state] ?? 0) + 1;
    return counts;
  });

  function countFor(state: string): number {
    return state === "all" ? data.machines.length : (stateCounts[state] ?? 0);
  }
</script>

<svelte:head>
  <title>Machines · {data.dashboard.appearance?.title || data.workspace.name} status</title>
  <meta name="description" content={`Public machine overview for ${data.workspace.name}`} />
</svelte:head>

<PublicSurface appearance={data.dashboard.appearance} workspace={data.workspace.slug}>
  <main>
    <PublicNavigation
      workspace={data.workspace}
      title={data.dashboard.appearance?.title}
      logoUrl={data.dashboard.appearance?.logoUrl}
    />
    <header class="page-header">
      <div>
        <a class="back" href={`/status/${data.workspace.slug}`}
          ><ArrowLeft size={15} />Status overview</a
        >
        <div class="title-row">
          <div>
            <span class="workspace">{data.dashboard.appearance?.title || data.workspace.name}</span>
            <h1>Machines</h1>
            <p>{data.machines.length} published machines</p>
          </div>
          <StatusLabel status={data.overallState} />
        </div>
      </div>
    </header>

    {#if data.machines.length > 0}
      <section class="summary" aria-label="Machine status summary">
        {#each statusFilters as option}
          <a class:active={status === option[0]} href={filterHref("status", option[0])}>
            <span>{option[1]}</span><strong>{countFor(option[0])}</strong>
          </a>
        {/each}
      </section>

      <div class="toolbar">
        <form class="filters" method="GET">
          {#if status !== "all"}<input type="hidden" name="status" value={status} />{/if}
          <label class="search-field">
            <Search size={15} aria-hidden="true" />
            <input
              name="q"
              value={queryValue}
              aria-label="Search machines"
              placeholder="Search machines"
            />
            <button
              class="search-submit"
              type="submit"
              aria-label="Search machines"
              title="Search machines"
            >
              <Search size={14} aria-hidden="true" />
            </button>
          </label>
          <SelectField
            portal={false}
            name="sort"
            label="Sort machines"
            value={sort}
            options={[
              { value: "priority", label: "Problems first" },
              { value: "name", label: "Name" },
              { value: "recent", label: "Last report" },
            ]}
            onvaluechange={submitFilters}
          />
        </form>
        <span class="result-count">
          {filteredMachines.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}-{Math.min(
            currentPage * pageSize,
            filteredMachines.length,
          )} of {filteredMachines.length}
        </span>
      </div>

      {#if filteredMachines.length > 0}
        <section class="machine-grid" aria-label="Published machines">
          {#each visibleMachines as machine (machine.slug)}
            <PublicMachineCard {machine} workspaceSlug={data.workspace.slug} />
          {/each}
        </section>
        {#if pageCount > 1}
          <nav class="pagination" aria-label="Published machine pages">
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
          compact
          icon={Search}
          title="No matching machines"
          description="Try another name or remove the active status filter."
        />
      {/if}
    {:else}
      <EmptyState
        icon={Server}
        title="No public machines"
        description="No machines have been published on this status page yet."
      />
    {/if}

    <footer>
      <span title={data.updatedAt === null ? undefined : new Date(data.updatedAt).toLocaleString()}
        >Updated {formatRelativeTime(data.updatedAt)}</span
      ><ProductAttribution />
    </footer>
  </main>
</PublicSurface>

<style>
  main {
    max-width: var(--content-narrow);
    margin: 0 auto;
    padding: 0 32px 40px;
  }

  .page-header {
    padding-bottom: var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .back:hover {
    color: var(--accent);
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .workspace {
    color: var(--text-faint);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    margin-top: var(--space-1);
    font-size: 34px;
    font-weight: 600;
    line-height: 1.25;
  }

  .title-row p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    margin-top: var(--space-5);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .summary a {
    display: grid;
    min-width: 0;
    gap: var(--space-1);
    padding: var(--space-3);
    color: var(--text-muted);
    text-decoration: none;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .summary a + a {
    border-left: 1px solid var(--border);
  }

  .summary a:hover,
  .summary a.active {
    color: var(--text);
    background: var(--surface-subtle);
  }

  .summary a.active {
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .summary span {
    overflow: hidden;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary strong {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) 0;
  }

  .filters {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
  }

  .search-field {
    display: flex;
    width: min(360px, 52vw);
    min-width: 0;
    height: 40px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2) 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text-faint);
    background: var(--surface);
  }

  .search-field:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .search-field input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    color: var(--text);
    background: transparent;
    font-size: var(--text-sm);
  }

  .search-field input::placeholder {
    color: var(--text-faint);
  }

  .search-submit {
    display: grid;
    width: 26px;
    height: 26px;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: transparent;
    cursor: pointer;
  }

  .search-submit:hover {
    color: var(--accent);
    background: var(--surface-subtle);
  }

  .result-count {
    flex: none;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .machine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
    gap: 20px;
  }

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    min-height: 32px;
    margin-top: var(--space-4);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .pagination a,
  .pagination span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
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
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-8);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  @media (max-width: 768px) {
    main {
      padding: 0 24px 32px;
    }

    .summary {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .summary a:nth-child(5) {
      border-left: 0;
    }

    .summary a:nth-child(n + 5) {
      border-top: 1px solid var(--border);
    }
  }

  @media (max-width: 620px) {
    .title-row {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-3);
    }

    .summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .summary a:nth-child(odd) {
      border-left: 0;
    }

    .summary a:nth-child(n + 3) {
      border-top: 1px solid var(--border);
    }

    .summary a:last-child:nth-child(odd) {
      grid-column: 1 / -1;
    }

    .toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .filters {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      width: 100%;
    }

    .search-field {
      width: 100%;
    }

    .result-count {
      text-align: right;
    }
  }

  @media (max-width: 480px) {
    main {
      padding: 0 18px 28px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .summary a {
      transition: none;
    }
  }
</style>
