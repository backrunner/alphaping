<script lang="ts">
  import { Menu, Search } from "@lucide/svelte";
  import type { WorkspaceShellData } from "@alphaping/db";

  import ThemeToggle from "$components/layout/theme-toggle.svelte";

  let {
    shell,
    menuOpen,
    onmenu,
  }: { shell: WorkspaceShellData; menuOpen: boolean; onmenu: () => void } = $props();
  const searchTarget = $derived(
    shell.navigation.machines ? "machines" : shell.navigation.services ? "services" : null,
  );
  const searchLabel = $derived(searchTarget === "services" ? "Search services" : "Search machines");
</script>

<header class="topbar">
  <button
    id="workspace-mobile-menu"
    class="icon-button mobile-menu"
    aria-label="Open navigation"
    aria-controls="workspace-navigation"
    aria-expanded={menuOpen}
    onclick={onmenu}
  >
    <Menu size={17} />
  </button>
  <a class="workspace-context" href="/workspaces" title="Switch workspace">
    <span>{shell.workspace.name}</span>
  </a>
  {#if searchTarget}<form
      class="search"
      method="GET"
      action={`/${shell.workspace.slug}/${searchTarget}`}
    >
      <Search size={14} />
      <input name="q" placeholder={searchLabel} aria-label={searchLabel} />
    </form>{/if}
  <span class="role">{shell.workspace.role}</span>
  <ThemeToggle />
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    height: 72px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-5);
    border-bottom: 0;
    background: var(--bg);
  }

  .workspace-context,
  .icon-button {
    display: inline-flex;
    height: 36px;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .workspace-context {
    max-width: 220px;
    overflow: hidden;
    flex: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;
  }

  .workspace-context:hover {
    border-color: var(--border-strong);
    color: var(--accent);
  }

  .search {
    display: flex;
    width: min(320px, 32vw);
    height: 40px;
    align-items: center;
    gap: var(--space-2);
    margin-right: auto;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text-faint);
    background: var(--surface);
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .search:hover {
    border-color: var(--border-strong);
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

  .search:focus-within {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .role {
    margin-left: auto;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: var(--text-sm);
    font-weight: 550;
    text-transform: capitalize;
  }

  .mobile-menu {
    display: none;
  }

  @media (max-width: 780px) {
    .mobile-menu {
      display: inline-flex;
      width: 28px;
      padding: 0;
    }

    .role {
      display: none;
    }

    .search {
      width: min(280px, 44vw);
    }

    .topbar {
      padding: 0 var(--space-4);
      height: 60px;
    }
  }

  @media (max-width: 420px) {
    .search {
      display: none;
    }

    .workspace-context {
      margin-right: auto;
    }
  }
</style>
