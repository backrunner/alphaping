<script lang="ts">
  import { Bell, ChevronDown, Menu, Search } from "lucide-svelte";
  import { Tooltip } from "bits-ui";
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
  <button class="workspace-switcher">
    <span>{shell.workspace.name}</span><ChevronDown size={14} />
  </button>
  <label class="search">
    <Search size={14} />
    <input placeholder="Search resources" aria-label="Search resources" />
  </label>
  <button class="range">Last 3 hours <ChevronDown size={13} /></button>
  <Tooltip.Root>
    <Tooltip.Trigger class="icon-button" aria-label="Notifications"
      ><Bell size={14} /></Tooltip.Trigger
    >
    <Tooltip.Portal>
      <Tooltip.Content class="tooltip-content" sideOffset={6}>Notifications</Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
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

  .workspace-switcher,
  .range,
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

  :global(.tooltip-content) {
    z-index: 50;
    padding: 5px 7px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text);
    background: var(--surface);
    font-size: 10px;
  }

  @media (max-width: 780px) {
    .mobile-menu {
      display: inline-flex;
      width: 28px;
      padding: 0;
    }

    .search,
    .role {
      display: none;
    }

    .topbar {
      padding: 0 12px;
    }

    .range {
      margin-left: auto;
    }
  }

  @media (max-width: 420px) {
    .range {
      display: none;
    }

    .workspace-switcher {
      margin-right: auto;
    }
  }
</style>
