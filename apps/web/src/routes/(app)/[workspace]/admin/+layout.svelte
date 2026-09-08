<script lang="ts">
  import { page } from "$app/state";
  import { Database, FileClock, ServerCog, ShieldCheck } from "@lucide/svelte";

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
      <a class:active={active(`${root}/audit`)} href={`${root}/audit`}
        ><FileClock size={15} />Audit log</a
      >
    </nav>
    <div class="admin-shell__content">{@render children()}</div>
  </div>
</div>

<style>
  .admin-shell {
    width: min(100% - 40px, 1240px);
    margin: 0 auto;
    padding: 20px 0 48px;
  }

  header {
    display: flex;
    min-height: 56px;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  header span {
    color: var(--text-muted);
    font-size: 11px;
  }

  h1 {
    margin: 4px 0 0;
    font-size: 21px;
  }

  header > strong {
    padding: 4px 7px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: 10px;
    font-weight: 650;
  }

  .admin-shell__body {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 28px;
    padding-top: 20px;
  }

  nav {
    display: grid;
    align-content: start;
    gap: 2px;
  }

  nav a {
    display: flex;
    height: 32px;
    align-items: center;
    gap: 8px;
    padding: 0 9px;
    border-radius: 5px;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: none;
  }

  nav a:hover,
  nav a.active {
    color: var(--text);
    background: var(--surface-subtle);
  }

  nav a.active {
    font-weight: 650;
  }

  .admin-shell__content {
    min-width: 0;
  }

  @media (max-width: 780px) {
    .admin-shell {
      width: min(100% - 24px, 1240px);
      padding-top: 14px;
    }

    .admin-shell__body {
      grid-template-columns: 1fr;
      gap: 18px;
    }

    nav {
      display: flex;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    nav a {
      flex: 0 0 auto;
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
</style>
