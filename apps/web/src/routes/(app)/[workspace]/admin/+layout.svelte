<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Bell, Database, FileClock, Palette, ServerCog, ShieldCheck } from "@lucide/svelte";

  let { data, children } = $props();
  const root = $derived(`/${data.shell.workspace.slug}/admin`);

  const sections = $derived([
    { href: root, label: "Resources", icon: ServerCog },
    { href: `${root}/access`, label: "Access", icon: ShieldCheck },
    { href: `${root}/settings`, label: "Data & visibility", icon: Database },
    { href: `${root}/appearance`, label: "Appearance", icon: Palette },
    { href: `${root}/notifications`, label: "Notifications", icon: Bell },
    { href: `${root}/audit`, label: "Audit log", icon: FileClock },
  ]);
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
      {#each sections as section (section.href)}
        <a
          class:active={page.url.pathname === section.href}
          aria-current={page.url.pathname === section.href ? "page" : undefined}
          href={section.href}><section.icon size={15} />{section.label}</a
        >
      {/each}
    </nav>
    <label class="section-picker">
      <span>Administration section</span>
      <select value={page.url.pathname} onchange={(event) => void goto(event.currentTarget.value)}>
        {#each sections as section (section.href)}<option value={section.href}
            >{section.label}</option
          >{/each}
      </select>
    </label>
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
    container-type: inline-size;
    min-width: 0;
  }

  @container (max-width: 1060px) {
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

  .section-picker {
    display: none;
  }

  @container (max-width: 640px) {
    nav {
      display: none;
    }
    header > strong {
      display: none;
    }
    .section-picker {
      display: grid;
      gap: var(--space-1);
    }
    .section-picker span {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .section-picker select {
      width: 100%;
      min-width: 0;
      height: var(--control-size);
      padding: 0 var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      color: var(--text);
      background: var(--surface);
    }
    .admin-shell__body {
      gap: var(--space-5);
      padding-top: var(--space-4);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    nav a {
      transition: none;
    }
  }
</style>
