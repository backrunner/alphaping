<script lang="ts">
  import { Menu, Search } from "lucide-svelte";
  import type { WorkspaceShellData } from "@alphaping/db";

  let {
    shell,
    menuOpen,
    onmenu,
  }: { shell: WorkspaceShellData; menuOpen: boolean; onmenu: () => void } = $props();
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
  <form class="search" method="GET" action={`/${shell.workspace.slug}/machines`}>
    <Search size={14} />
    <input name="q" placeholder="Search machines" aria-label="Search machines" />
  </form>
  <span class="role">{shell.workspace.role}</span>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    height: 48px;
    align-items: center;
    gap: 10px;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(10px);
  }

  .workspace-context,
  .icon-button {
    display: inline-flex;
    height: 28px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 11px;
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
    color: var(--accent);
  }

  .search {
    display: flex;
    width: min(320px, 32vw);
    height: 28px;
    align-items: center;
    gap: 7px;
    margin-right: auto;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
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
    font-size: 11px;
  }

  .role {
    padding: 3px 7px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: 10px;
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
      padding: 0 12px;
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
