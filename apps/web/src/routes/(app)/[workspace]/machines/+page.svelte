<script lang="ts">
  import { page } from "$app/state";
  import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Search, Server } from "@lucide/svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import MachineCard from "$components/machines/machine-card.svelte";
  import Button from "$components/ui/button/button.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";
  import SelectField from "$components/ui/select/select.svelte";

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

  function submitFilters(): void {
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
        <SelectField
          name="platform"
          label="Filter by operating system"
          value={platform}
          options={[
            { value: "", label: "All systems" },
            ...platformOptions.map((option) => ({ value: option, label: option })),
          ]}
          onvaluechange={submitFilters}
        />
        <SelectField
          name="version"
          label="Filter by Agent version"
          value={version}
          options={[
            { value: "", label: "All versions" },
            ...versionOptions.map((option) => ({ value: option, label: option })),
          ]}
          onvaluechange={submitFilters}
        />
        <SelectField
          name="tag"
          label="Filter by machine label"
          value={tag}
          options={[
            { value: "", label: "All labels" },
            ...tagOptions.map((option) => ({ value: option, label: option })),
          ]}
          onvaluechange={submitFilters}
        />
        <SelectField
          name="container"
          label="Filter by container monitoring"
          value={container}
          options={[
            { value: "", label: "All container states" },
            { value: "enabled", label: "Containers enabled" },
            { value: "disabled", label: "Containers disabled" },
          ]}
          onvaluechange={submitFilters}
        />
        <SelectField
          name="sort"
          label="Sort machines"
          value={sort}
          options={[
            { value: "priority", label: "Problems first" },
            { value: "name", label: "Name" },
            { value: "download", label: "Download rate" },
            { value: "upload", label: "Upload rate" },
            { value: "recent", label: "Last report" },
          ]}
          onvaluechange={submitFilters}
        />
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
      <EmptyState
        compact
        icon={Search}
        title="No matching machines"
        description="Change the search query or remove one of the active filters."
      />
    {/if}
  {:else}
    <EmptyState
      icon={Server}
      title="No machines available"
      description="No machine has been configured or granted to this account."
    />
  {/if}
</main>

<style>
  .machines-page {
    width: min(100% - 24px, 1180px);
    margin: 0 auto;
    padding: 28px 0 52px;
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
  p {
    margin: 0;
  }

  h1 {
    margin-top: 14px;
    font-size: 24px;
  }

  .page-header p,
  .page-header p {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 12px;
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
    border-radius: var(--radius-control);
    color: var(--text-faint);
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
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

  .search-submit {
    height: 34px;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    background: var(--surface);
    font: inherit;
    font-size: 12px;
  }

  .filters :global(.select-trigger) {
    width: auto;
    max-width: 132px;
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
    font-size: 12px;
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
    font-size: 11px;
  }

  .machine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
    gap: 14px;
  }

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: 16px;
    color: var(--text-faint);
    font-size: 11px;
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

    .filters :global(.select-trigger) {
      max-width: none;
      flex: 1 1 140px;
    }

    .segments {
      overflow-x: auto;
    }
  }
</style>
