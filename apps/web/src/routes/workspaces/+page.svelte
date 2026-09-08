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
  } from "@lucide/svelte";

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
        <p>Select a workspace or recover one pending deletion.</p>
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
    width: min(100% - 24px, var(--content-form));
    margin: 0 auto;
    padding: var(--space-6) 0 var(--space-8);
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
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    gap: var(--space-2);
  }

  .brand > span {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border-radius: var(--radius-button);
    color: var(--accent-ink);
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 750;
  }

  .brand strong {
    font-size: var(--text-base);
  }

  .workspace-list {
    padding-top: var(--space-6);
  }

  .workspace-list > header {
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }

  .workspace-list header p,
  .workspace-count > span,
  .identity span,
  .recovery > span,
  .empty {
    color: var(--text-muted);
  }

  .workspace-list header p {
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  .workspace-count {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .workspace-count > span {
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .create-workspace {
    position: relative;
  }

  .create-workspace summary {
    display: inline-flex;
    height: 32px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
    color: var(--text);
    background: var(--surface);
    font-size: var(--text-base);
    font-weight: 600;
    list-style: none;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .create-workspace summary:hover,
  .create-workspace[open] summary {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .create-workspace summary::-webkit-details-marker {
    display: none;
  }

  .create-workspace form {
    position: absolute;
    z-index: var(--z-popover);
    top: calc(100% + var(--space-2));
    right: 0;
    display: grid;
    width: min(480px, calc(100vw - 24px));
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
  }

  .create-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .create-fields label:first-child {
    grid-column: 1 / -1;
  }

  .create-fields span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .create-fields input,
  .create-fields select {
    width: 100%;
    height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }

  .create-workspace form > :global(button) {
    justify-self: end;
  }

  .rows {
    border-top: 1px solid var(--border);
  }

  article {
    min-height: 60px;
    gap: var(--space-3);
    margin: 0 calc(-1 * var(--space-3));
    padding: var(--space-3);
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-card);
    transition: background-color 140ms ease;
  }

  article:hover {
    background: var(--surface-subtle);
  }

  article > :global(svg) {
    flex: none;
    color: var(--text-faint);
  }

  article.deleted,
  article.deleted:hover {
    background: color-mix(in srgb, var(--status-down-bg) 40%, transparent);
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
    font-size: var(--text-base);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity span {
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  article > a {
    flex: none;
    gap: var(--space-1);
    color: var(--accent);
    font-size: var(--text-sm);
    font-weight: 600;
    text-decoration: none;
  }

  article > a:hover {
    text-decoration: underline;
  }

  .recovery {
    gap: var(--space-3);
  }

  .recovery > span {
    gap: var(--space-1);
    font-size: var(--text-xs);
  }

  .error {
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-button);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  .empty {
    padding: var(--space-5) var(--space-3);
    font-size: var(--text-sm);
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
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

  .pagination strong {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
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
      width: calc(100% - 17px - var(--space-3));
      flex: none;
    }

    article > a,
    .recovery {
      width: 100%;
      justify-content: flex-end;
      padding-left: calc(17px + var(--space-3));
    }

    .recovery {
      align-items: flex-end;
      flex-direction: column;
      gap: var(--space-2);
    }
  }
</style>
