<script lang="ts">
  import {
    ArrowRight,
    Building2,
    ChevronLeft,
    ChevronRight,
    Clock3,
    LogOut,
    Plus,
    RotateCcw,
  } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();

  function recoveryLabel(value: number | null): string {
    if (value === null) return "";
    if (value <= data.now) return "Recovery window expired";
    return `Recoverable until ${new Date(value).toLocaleString()}`;
  }

  function paginationHref(value: number): string {
    if (value <= 1) return "/workspaces";
    return `/workspaces?page=${value}`;
  }
</script>

<svelte:head><title>Workspaces · AlphaPing</title></svelte:head>

<main>
  <header class="page-header">
    <div class="brand"><span>A</span><strong>AlphaPing</strong></div>
    <form method="POST" action="?/logout">
      <Button type="submit" variant="secondary"><LogOut size={13} />Sign out</Button>
    </form>
  </header>

  <section class="workspace-list" aria-labelledby="workspace-heading">
    <header>
      <div>
        <h1 id="workspace-heading">Workspaces</h1>
        <p>Select an operations workspace or recover one pending deletion.</p>
      </div>
      <div class="workspace-count">
        <span
          >{data.workspaces.activeCount}{data.workspaces.activeCountCapped ? "+" : ""} active</span
        >
        <details class="create-workspace" open={form?.kind === "create"}>
          <summary><Plus size={13} />New workspace</summary>
          <form method="POST" action="?/create">
            {#if form?.kind === "create" && form.message}<p class="error" role="alert">
                {form.message}
              </p>{/if}
            <div class="create-fields">
              <label
                ><span>Name</span><input name="name" required minlength="2" maxlength="80" /></label
              >
              <label
                ><span>URL slug</span><input
                  name="slug"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  minlength="3"
                  maxlength="48"
                  required
                /></label
              >
              <label
                ><span>Default sampling</span><select name="defaultSamplingIntervalSeconds">
                  <option value="5">5 seconds</option><option value="10" selected>10 seconds</option
                  ><option value="15">15 seconds</option><option value="30">30 seconds</option
                  ><option value="60">60 seconds</option>
                </select></label
              >
              <label
                ><span>Dashboard access</span><select name="dashboardVisibility">
                  <option value="private">Private</option><option value="authenticated"
                    >Authenticated</option
                  ><option value="public">Public status</option>
                </select></label
              >
              <label
                ><span>Raw retention</span><select name="rawDays">
                  <option value="7">7 days</option><option value="14">14 days</option><option
                    value="30">30 days</option
                  >
                </select></label
              >
            </div>
            <Button type="submit"><Plus size={13} />Create workspace</Button>
          </form>
        </details>
      </div>
    </header>

    {#if form?.kind === "restore" && form.message}<p class="error" role="alert">
        {form.message}
      </p>{/if}

    <div class="rows">
      {#each data.workspaces.workspaces as workspace (workspace.id)}
        <article class:deleted={workspace.deletedAt !== null}>
          <Building2 size={17} />
          <div class="identity">
            <strong>{workspace.name}</strong>
            <span>/{workspace.slug} · {workspace.role}</span>
          </div>
          {#if workspace.deletedAt === null}
            <a href={`/${workspace.slug}`} aria-label={`Open ${workspace.name}`}
              >Open <ArrowRight size={13} /></a
            >
          {:else}
            <div class="recovery">
              <span><Clock3 size={12} />{recoveryLabel(workspace.recoverableUntil)}</span>
              {#if workspace.role === "admin" && (workspace.recoverableUntil ?? 0) > data.now}
                <form method="POST" action="?/restore">
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <Button type="submit" variant="secondary"><RotateCcw size={13} />Restore</Button>
                </form>
              {/if}
            </div>
          {/if}
        </article>
      {:else}
        <p class="empty">No active workspace memberships are available.</p>
      {/each}
    </div>
    {#if data.workspaces.pages > 1}
      <nav class="pagination" aria-label="Workspace pages">
        {#if data.workspaces.page > 1}
          <a href={paginationHref(data.workspaces.page - 1)}><ChevronLeft size={14} />Previous</a>
        {:else}<span><ChevronLeft size={14} />Previous</span>{/if}
        <strong
          >{(data.workspaces.page - 1) * data.workspaces.pageSize + 1}-{Math.min(
            data.workspaces.page * data.workspaces.pageSize,
            data.workspaces.total,
          )} of {data.workspaces.total}{data.workspaces.totalCapped ? "+" : ""}</strong
        >
        {#if data.workspaces.page < data.workspaces.pages}
          <a href={paginationHref(data.workspaces.page + 1)}>Next<ChevronRight size={14} /></a>
        {:else}<span>Next<ChevronRight size={14} /></span>{/if}
      </nav>
    {/if}
  </section>
</main>

<style>
  main {
    width: min(100% - 24px, 780px);
    margin: 0 auto;
    padding: 22px 0 48px;
  }

  .page-header,
  .workspace-list > header,
  article,
  .brand,
  .recovery,
  .recovery > span,
  article > a {
    display: flex;
    align-items: center;
  }

  .page-header {
    justify-content: space-between;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }

  .brand {
    gap: 9px;
  }

  .brand > span {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border-radius: 5px;
    color: var(--accent-ink);
    background: var(--accent);
    font-family: var(--font-mono);
    font-weight: 750;
  }

  .brand strong {
    font-size: 13px;
  }

  .workspace-list {
    padding-top: 28px;
  }

  .workspace-list > header {
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    font-size: 22px;
  }

  .workspace-list header p,
  .workspace-count > span,
  .identity span,
  .recovery > span,
  .empty {
    color: var(--text-muted);
    font-size: 10px;
  }

  .workspace-count {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .create-workspace {
    position: relative;
  }

  .create-workspace summary {
    display: inline-flex;
    height: 30px;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font-size: 10px;
    font-weight: 650;
    list-style: none;
    cursor: pointer;
  }

  .create-workspace summary::-webkit-details-marker {
    display: none;
  }

  .create-workspace form {
    position: absolute;
    z-index: 4;
    top: 36px;
    right: 0;
    display: grid;
    width: min(520px, calc(100vw - 24px));
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    box-shadow: 0 12px 32px color-mix(in srgb, var(--text) 12%, transparent);
  }

  .create-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .create-fields label:first-child {
    grid-column: 1 / -1;
  }

  .create-fields span {
    display: block;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 9px;
  }

  .create-fields input,
  .create-fields select {
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }

  .create-workspace form > :global(button) {
    justify-self: end;
  }

  .workspace-list header p {
    margin-top: 4px;
    font-size: 11px;
  }

  .rows {
    border-block: 1px solid var(--border);
  }

  article {
    min-height: 64px;
    gap: 11px;
    padding: 10px 0;
    border-top: 1px solid var(--border);
  }

  article:first-child {
    border-top: 0;
  }

  article > :global(svg) {
    flex: none;
    color: var(--text-faint);
  }

  article.deleted {
    background: color-mix(in srgb, var(--status-down-bg) 32%, transparent);
  }

  .identity {
    min-width: 0;
    flex: 1;
  }

  .identity strong,
  .identity span {
    display: block;
  }

  .identity strong {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity span {
    margin-top: 2px;
    font-family: var(--font-mono);
  }

  article > a {
    gap: 5px;
    color: var(--accent);
    font-size: 10px;
    font-weight: 650;
    text-decoration: none;
  }

  .recovery {
    gap: 12px;
  }

  .recovery > span {
    gap: 5px;
  }

  .error {
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: 10px;
  }

  .empty {
    padding: 18px 0;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 12px;
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

  .pagination strong {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
  }

  @media (max-width: 560px) {
    .workspace-list > header,
    .workspace-count {
      width: 100%;
      align-items: flex-start;
      flex-direction: column;
    }

    .create-workspace,
    .create-workspace summary {
      width: 100%;
    }

    .create-workspace summary {
      justify-content: center;
    }

    .create-workspace form {
      right: auto;
      left: 0;
    }

    .create-fields {
      grid-template-columns: 1fr;
    }

    .create-fields label:first-child {
      grid-column: auto;
    }

    article {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .identity {
      width: calc(100% - 32px);
      flex: none;
    }

    article > a,
    .recovery {
      width: 100%;
      justify-content: flex-end;
      padding-left: 28px;
    }

    .recovery {
      align-items: flex-end;
      flex-direction: column;
      gap: 7px;
    }
  }
</style>
