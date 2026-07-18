<script lang="ts">
  import { page } from "$app/state";
  import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Search, Server } from "lucide-svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import MachineCard from "$components/machines/machine-card.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data } = $props();
  const pageSize = 60;
  const statusOptions = ["all", "online", "impaired", "offline", "unknown"] as const;
  const statusFilters = [
    ["all", "All"],
    ["online", "Online"],
    ["impaired", "Impaired"],
    ["offline", "Offline"],
    ["unknown", "Unknown"],
  ] as const;
  const sortOptions = ["priority", "name", "download", "upload", "recent"] as const;
  type StatusFilter = (typeof statusOptions)[number];
  type SortOption = (typeof sortOptions)[number];

  function selected<T extends string>(name: string, options: readonly T[], fallback: T): T {
    const value = page.url.searchParams.get(name);
    return options.includes(value as T) ? (value as T) : fallback;
  }

  function labelTokens(machine: (typeof data.machines)[number]): string[] {
    return Object.entries(machine.labels).map(([key, value]) => `${key}=${value}`);
  }

  function statePriority(state: (typeof data.machines)[number]["state"]): number {
    return { down: 0, degraded: 1, offline: 2, unknown: 3, maintenance: 4, healthy: 5 }[state];
  }

  function submitFilters(event: Event): void {
    const select = event.currentTarget;
    if (select instanceof HTMLSelectElement) select.form?.requestSubmit();
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
  const platform = $derived(page.url.searchParams.get("platform") ?? "");
  const version = $derived(page.url.searchParams.get("version") ?? "");
  const tag = $derived(page.url.searchParams.get("tag") ?? "");
  const container = $derived(page.url.searchParams.get("container") ?? "");
  const sort = $derived(selected<SortOption>("sort", sortOptions, "priority"));
  const platformOptions = $derived(
    [
      ...new Set(data.machines.flatMap((machine) => (machine.platform ? [machine.platform] : []))),
    ].sort(),
  );
  const versionOptions = $derived(
    [
      ...new Set(
        data.machines.flatMap((machine) => (machine.agentVersion ? [machine.agentVersion] : [])),
      ),
    ].sort(),
  );
  const tagOptions = $derived([...new Set(data.machines.flatMap(labelTokens))].sort());
  const filteredMachines = $derived.by(() => {
    const matches = data.machines.filter((machine) => {
      const searchText = [
        machine.name,
        machine.platform ?? "",
        machine.arch ?? "",
        machine.agentVersion ?? "",
        ...labelTokens(machine),
      ]
        .join(" ")
        .toLowerCase();
      const matchesStatus =
        status === "all" ||
        (status === "online" && machine.state === "healthy") ||
        (status === "impaired" && (machine.state === "degraded" || machine.state === "down")) ||
        (status === "offline" && machine.state === "offline") ||
        (status === "unknown" && machine.state === "unknown");
      return (
        searchText.includes(query) &&
        matchesStatus &&
        (platform === "" || machine.platform === platform) &&
        (version === "" || machine.agentVersion === version) &&
        (tag === "" || labelTokens(machine).includes(tag)) &&
        (container === "" || machine.containersEnabled === (container === "enabled"))
      );
    });
    return matches.toSorted((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "download") return right.networkRxBps - left.networkRxBps;
      if (sort === "upload") return right.networkTxBps - left.networkTxBps;
      if (sort === "recent") return (right.observedAt ?? 0) - (left.observedAt ?? 0);
      return (
        statePriority(left.state) - statePriority(right.state) ||
        left.name.localeCompare(right.name)
      );
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
      <form class="filters" method="GET">
        {#if status !== "all"}<input type="hidden" name="status" value={status} />{/if}
        <label class="search">
          <Search size={14} />
          <input
            name="q"
            value={queryValue}
            aria-label="Search machines"
            placeholder="Search machines"
          />
        </label>
        <select
          name="platform"
          aria-label="Filter by operating system"
          value={platform}
          onchange={submitFilters}
        >
          <option value="">All systems</option>
          {#each platformOptions as option}<option value={option}>{option}</option>{/each}
        </select>
        <select
          name="version"
          aria-label="Filter by Agent version"
          value={version}
          onchange={submitFilters}
        >
          <option value="">All versions</option>
          {#each versionOptions as option}<option value={option}>{option}</option>{/each}
        </select>
        <select
          name="tag"
          aria-label="Filter by machine label"
          value={tag}
          onchange={submitFilters}
        >
          <option value="">All labels</option>
          {#each tagOptions as option}<option value={option}>{option}</option>{/each}
        </select>
        <select
          name="container"
          aria-label="Filter by container monitoring"
          value={container}
          onchange={submitFilters}
        >
          <option value="">All container states</option>
          <option value="enabled">Containers enabled</option>
          <option value="disabled">Containers disabled</option>
        </select>
        <select name="sort" aria-label="Sort machines" value={sort} onchange={submitFilters}>
          <option value="priority">Problems first</option>
          <option value="name">Name</option>
          <option value="download">Download rate</option>
          <option value="upload">Upload rate</option>
          <option value="recent">Last report</option>
        </select>
        <button class="search-submit" type="submit">Search</button>
      </form>
      <nav class="segments" aria-label="Filter machine status">
        {#each statusFilters as option}
          <a
            class:active={status === option[0]}
            aria-current={status === option[0] ? "page" : undefined}
            href={filterHref("status", option[0])}>{option[1]}</a
          >
        {/each}
      </nav>
      <span class="result-count">
        {visibleMachines.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}-{Math.min(
          currentPage * pageSize,
          filteredMachines.length,
        )} of {filteredMachines.length}
      </span>
    </div>

    {#if filteredMachines.length > 0}
      <section class="machine-grid" aria-label="Machines">
        {#each visibleMachines as machine (machine.id)}
          <MachineCard {machine} workspaceSlug={data.workspace.slug} />
        {/each}
      </section>
      {#if pageCount > 1}
        <nav class="pagination" aria-label="Machine pages">
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
    display: grid;
    min-height: 94px;
    grid-template-columns: minmax(0, 1fr) auto;
    align-content: center;
    gap: 12px;
  }

  .filters {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
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

  .search:focus-within {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .filters select,
  .search-submit {
    height: 30px;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-muted);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }

  .filters select {
    max-width: 132px;
    padding: 0 22px 0 7px;
  }

  .search-submit {
    padding: 0 9px;
    color: var(--text);
    cursor: pointer;
  }

  .segments {
    display: flex;
    grid-column: 1;
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

  .result-count {
    grid-column: 2;
    grid-row: 2;
    align-self: center;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .machine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
    gap: 10px;
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
      grid-template-columns: 1fr auto;
      padding: 12px 0;
    }

    .filters {
      grid-column: 1 / -1;
      flex-wrap: wrap;
    }

    .search {
      width: 100%;
    }

    .filters select {
      max-width: none;
      flex: 1 1 140px;
    }

    .segments {
      overflow-x: auto;
    }
  }
</style>
