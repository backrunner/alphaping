<script lang="ts">
  import SiteLogo from "$components/layout/site-logo.svelte";
  import { page } from "$app/state";
  import {
    Activity,
    Bell,
    BellRing,
    CircleGauge,
    LogOut,
    MonitorCog,
    Server,
    X,
  } from "@lucide/svelte";
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
    <SiteLogo size={36} /><strong>AlphaPing</strong>
    <button
      id="workspace-navigation-close"
      class="close"
      aria-label="Close navigation"
      onclick={onclose}><X size={16} /></button
    >
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
      <a
        class:active={isActive(`${rootPath}/admin`, true)}
        href={`${rootPath}/admin`}
        onclick={onclose}><MonitorCog size={16} />Admin</a
      >
      <a
        class:active={isActive(`${rootPath}/admin/notifications`)}
        href={`${rootPath}/admin/notifications`}
        onclick={onclose}><BellRing size={16} />Notifications</a
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
    top: 12px;
    z-index: var(--z-sticky);
    display: flex;
    height: calc(100dvh - 24px);
    flex-direction: column;
    padding: 6px 10px 12px;
    margin: 12px 0 12px 12px;
    border: 1px solid var(--border);
    border-radius: 22px;
    box-shadow: var(--shadow-card);
    background: var(--surface);
  }

  .brand {
    display: flex;
    height: 64px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }

  .brand strong {
    font-size: var(--text-base);
  }

  .close {
    display: none;
    width: 28px;
    height: 28px;
    margin-left: auto;
    place-items: center;
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: transparent;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .close:hover {
    color: var(--text);
    background: var(--surface-subtle);
  }

  nav {
    display: grid;
    gap: 6px;
    margin-top: var(--space-2);
  }

  nav a,
  nav button {
    display: flex;
    width: 100%;
    height: 42px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: none;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      box-shadow 120ms ease;
  }

  nav a:hover,
  nav button:hover {
    color: var(--text);
    background: var(--surface-subtle);
  }

  nav a.active {
    color: var(--accent);
    background: var(--accent-soft);
    box-shadow: none;
    font-weight: 620;
  }

  nav a.active:hover {
    background: color-mix(in srgb, var(--accent) 13%, transparent);
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
      top: 0;
      left: 0;
      margin: 0;
      height: 100dvh;
      border-radius: 0 22px 22px 0;
      z-index: var(--z-dialog);
      visibility: hidden;
      translate: -100% 0;
      width: 260px;
      box-shadow: var(--navigation-shadow);
      transition:
        translate 140ms ease,
        visibility 0s linear 140ms;
    }

    .sidebar.open {
      visibility: visible;
      translate: 0 0;
      transition-delay: 0s;
    }

    .close {
      display: grid;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: var(--z-overlay);
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
