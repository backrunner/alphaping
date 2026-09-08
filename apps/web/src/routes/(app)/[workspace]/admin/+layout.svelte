<script lang="ts">
  import { page } from "$app/state";
  import { Database, FileClock, Palette, ServerCog, ShieldCheck } from "@lucide/svelte";

  let { data, children } = $props();
  const root = $derived(`/${data.shell.workspace.slug}/admin`);

  function active(path: string, exact = false): boolean {
    return exact ? page.url.pathname === path : page.url.pathname.startsWith(path);
  }
</script>

<div class="admin-shell">
  <header>
    <div>
      <span>Workspace administration</span>
      <h1>{data.shell.workspace.name}</h1>
    </div>
    <strong>Administrator</strong>
  </header>
  <div class="admin-shell__body">
    <nav aria-label="Administration sections">
      <a class:active={active(root, true)} href={root}><ServerCog size={15} />Resources</a>
      <a class:active={active(`${root}/access`)} href={`${root}/access`}
        ><ShieldCheck size={15} />Access</a
      >
      <a class:active={active(`${root}/settings`)} href={`${root}/settings`}
        ><Database size={15} />Data & visibility</a
      >
      <a class:active={active(`${root}/appearance`)} href={`${root}/appearance`}
        ><Palette size={15} />Appearance</a
      >
      <a class:active={active(`${root}/audit`)} href={`${root}/audit`}
        ><FileClock size={15} />Audit log</a
      >
    </nav>
    <div class="admin-shell__content">{@render children()}</div>
  </div>
</div>

<style>
  .admin-shell {
    width: min(100% - 40px, var(--content-admin));
    margin: 0 auto;
    padding: var(--space-5) 0 var(--space-8);
  }

  header {
    display: flex;
    min-height: 56px;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  header span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  h1 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }

  header > strong {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  .admin-shell__body {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: var(--space-8);
    padding-top: var(--space-5);
  }

  nav {
    display: grid;
    align-content: start;
    gap: 2px;
  }

  nav a {
    position: relative;
    display: flex;
    height: 32px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2) 0 var(--space-3);
    border-radius: var(--radius-button);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-decoration: none;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  nav a:hover {
    color: var(--text);
    background: var(--surface-subtle);
  }

  nav a.active {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    font-weight: 620;
  }

  nav a.active::before {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 0;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
    content: "";
  }

  .admin-shell__content {
    min-width: 0;
  }

  @media (max-width: 780px) {
    .admin-shell {
      width: min(100% - 24px, var(--content-admin));
      padding-top: var(--space-4);
    }

    .admin-shell__body {
      grid-template-columns: 1fr;
      gap: var(--space-5);
    }

    nav {
      display: flex;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    nav a {
      flex: 0 0 auto;
    }

    nav a.active::before {
      top: auto;
      right: var(--space-2);
      bottom: 0;
      left: var(--space-2);
      width: auto;
      height: 2px;
    }
  }

  @media (max-width: 480px) {
    nav {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      overflow-x: visible;
    }

    nav a {
      min-width: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    nav a {
      transition: none;
    }
  }
</style>
