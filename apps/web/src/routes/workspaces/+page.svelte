<script lang="ts">
  import { ArrowRight, Building2, Clock3, LogOut, RotateCcw } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();

  function recoveryLabel(value: number | null): string {
    if (value === null) return "";
    if (value <= data.now) return "Recovery window expired";
    return `Recoverable until ${new Date(value).toLocaleString()}`;
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
      <span
        >{data.workspaces.filter((workspace) => workspace.deletedAt === null).length} active</span
      >
    </header>

    {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}

    <div class="rows">
      {#each data.workspaces as workspace (workspace.id)}
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
    color: white;
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
  .workspace-list header > span,
  .identity span,
  .recovery > span,
  .empty {
    color: var(--text-muted);
    font-size: 10px;
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

  @media (max-width: 560px) {
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
