<script lang="ts">
  import { page } from "$app/state";
  import { Activity, Bell, CircleGauge, LogOut, MonitorCog, Server, X } from "lucide-svelte";
  import type { WorkspaceShellData } from "@alphaping/db";

  let { shell, open, onclose }: { shell: WorkspaceShellData; open: boolean; onclose: () => void } =
    $props();

  const rootPath = $derived(`/${shell.workspace.slug}`);

  function isActive(path: string, exact = false): boolean {
    return exact
      ? page.url.pathname === path
      : page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
  }
</script>

{#if open}<button class="backdrop" aria-label="Close navigation" onclick={onclose}></button>{/if}

<aside id="workspace-navigation" class:open class="sidebar">
  <div class="brand">
    <span>A</span><strong>AlphaPing</strong>
    <button class="close" aria-label="Close navigation" onclick={onclose}><X size={16} /></button>
  </div>
  <nav aria-label="Primary navigation">
    <a class:active={isActive(rootPath, true)} href={rootPath} onclick={onclose}
      ><CircleGauge size={16} />Overview</a
    >
    {#if shell.navigation.machines}
      <a
        class:active={isActive(`${rootPath}/machines`)}
        href={`${rootPath}/machines`}
        onclick={onclose}><Server size={16} />Machines</a
      >
    {/if}
    {#if shell.navigation.services}
      <a
        class:active={isActive(`${rootPath}/services`)}
        href={`${rootPath}/services`}
        onclick={onclose}><Activity size={16} />Services</a
      >
    {/if}
    <a
      class:active={isActive(`${rootPath}/incidents`)}
      href={`${rootPath}/incidents`}
      onclick={onclose}><Bell size={16} />Incidents</a
    >
  </nav>
  <nav class="sidebar__bottom" aria-label="Administration">
    {#if shell.navigation.developer}
      <a class:active={isActive(`${rootPath}/admin`)} href={`${rootPath}/admin`} onclick={onclose}
        ><MonitorCog size={16} />Admin</a
      >
    {/if}
    <form method="POST" action={`${rootPath}?/logout`}>
      <button><LogOut size={16} />Sign out</button>
    </form>
  </nav>
</aside>

<style>
  .sidebar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    height: 100dvh;
    flex-direction: column;
    padding: 0 10px 10px;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: flex;
    height: 48px;
    align-items: center;
    gap: 9px;
    padding: 0 8px;
  }

  .brand > span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 5px;
    color: var(--accent-ink);
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 750;
  }

  .brand strong {
    font-size: 13px;
  }

  .close {
    display: none;
    width: 28px;
    height: 28px;
    margin-left: auto;
    place-items: center;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
  }

  nav {
    display: grid;
    gap: 2px;
    margin-top: 8px;
  }

  nav a,
  nav button {
    display: flex;
    width: 100%;
    height: 32px;
    align-items: center;
    gap: 9px;
    padding: 0 9px;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: 12px;
    text-decoration: none;
    cursor: pointer;
  }

  nav a:hover,
  nav button:hover,
  nav a.active {
    color: var(--text);
    background: var(--surface-subtle);
  }

  nav a.active {
    font-weight: 620;
  }

  .sidebar__bottom {
    margin-top: auto;
  }

  .backdrop {
    display: none;
  }

  @media (max-width: 780px) {
    .sidebar {
      position: fixed;
      left: 0;
      z-index: 70;
      translate: -100% 0;
      width: 216px;
      box-shadow: var(--navigation-shadow);
      transition: translate 140ms ease;
    }

    .sidebar.open {
      translate: 0 0;
    }

    .close {
      display: grid;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: block;
      border: 0;
      background: var(--overlay-backdrop);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none;
    }
  }
</style>
