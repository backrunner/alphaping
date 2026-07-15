<script lang="ts">
  import {
    Activity,
    Bell,
    Boxes,
    ChevronDown,
    CircleGauge,
    LogOut,
    Menu,
    MonitorCog,
    Plus,
    Search,
    Server,
    Settings,
  } from "lucide-svelte";
  import { Tooltip } from "bits-ui";

  import Metric from "$components/dashboard/metric.svelte";
  import MachineCard from "$components/machines/machine-card.svelte";
  import ServiceRow from "$components/services/service-row.svelte";
  import Button from "$components/ui/button/button.svelte";
  import { formatBytes, formatRate } from "$lib/utils/format";

  let { data } = $props();
  let mobileNavOpen = $state(false);
</script>

<svelte:head><title>{data.workspace.name} · AlphaPing</title></svelte:head>

<Tooltip.Provider delayDuration={300}>
  <div class="shell">
    <aside class:open={mobileNavOpen} class="sidebar">
      <div class="brand"><span>A</span><strong>AlphaPing</strong></div>
      <nav aria-label="Primary navigation">
        <a class="active" href={`/${data.workspace.slug}`}><CircleGauge size={16} />Overview</a>
        {#if data.machines.length > 0}
          <a href={`/${data.workspace.slug}/machines`}><Server size={16} />Machines</a>
        {/if}
        {#if data.services.length > 0}
          <a href={`/${data.workspace.slug}/services`}><Activity size={16} />Services</a>
        {/if}
        <a href={`/${data.workspace.slug}/incidents`}><Bell size={16} />Incidents</a>
      </nav>
      <nav class="sidebar__bottom" aria-label="Administration">
        <a href={`/${data.workspace.slug}/admin`}><MonitorCog size={16} />Developer</a>
        <a href={`/${data.workspace.slug}/settings`}><Settings size={16} />Settings</a>
        <form method="POST" action="?/logout"><button><LogOut size={16} />Sign out</button></form>
      </nav>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <button
          class="icon-button mobile-menu"
          aria-label="Toggle navigation"
          onclick={() => (mobileNavOpen = !mobileNavOpen)}
        >
          <Menu size={17} />
        </button>
        <button class="workspace-switcher">
          <span>{data.workspace.name}</span><ChevronDown size={14} />
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
        <span class="role">{data.workspace.role}</span>
      </header>

      <main class="content">
        <header class="page-header">
          <div>
            <h1>Overview</h1>
            <p>Updated from durable telemetry and live connections</p>
          </div>
          <Button onclick={() => (window.location.href = `/${data.workspace.slug}/admin`)}
            ><Plus size={14} />Add monitor</Button
          >
        </header>

        <section class="summary" aria-label="Monitoring summary">
          <Metric label="Machines" value={data.summary.machines} />
          <Metric label="Online" value={data.summary.online} tone="healthy" />
          <Metric
            label="Impaired"
            value={data.summary.impaired}
            tone={data.summary.impaired > 0 ? "danger" : "default"}
          />
          <Metric
            label="Offline"
            value={data.summary.offline}
            tone={data.summary.offline > 0 ? "danger" : "default"}
          />
          <Metric
            label="Download"
            value={formatRate(data.summary.networkRxBps)}
            detail={formatBytes(data.summary.networkRxTotal)}
          />
          <Metric
            label="Upload"
            value={formatRate(data.summary.networkTxBps)}
            detail={formatBytes(data.summary.networkTxTotal)}
          />
          {#if data.services.length > 0}
            <Metric
              label="Service faults"
              value={data.summary.servicesDown}
              tone={data.summary.servicesDown > 0 ? "danger" : "default"}
            />
          {/if}
        </section>

        {#if data.machines.length > 0}
          <section class="section">
            <header class="section__header">
              <div>
                <h2>Machines</h2>
                <span>{data.machines.length} resources</span>
              </div>
              <a href={`/${data.workspace.slug}/machines`}>View all</a>
            </header>
            <div class="machine-grid">
              {#each data.machines as machine (machine.id)}
                <MachineCard {machine} workspaceSlug={data.workspace.slug} />
              {/each}
            </div>
          </section>
        {/if}

        {#if data.services.length > 0}
          <section class="section">
            <header class="section__header">
              <div>
                <h2>Services</h2>
                <span>Last 150 minutes</span>
              </div>
              <a href={`/${data.workspace.slug}/services`}>Open status view</a>
            </header>
            <div>
              {#each data.services as service (service.id)}
                <ServiceRow {service} workspaceSlug={data.workspace.slug} />
              {/each}
            </div>
          </section>
        {/if}

        {#if data.machines.length === 0 && data.services.length === 0}
          <section class="empty">
            <Boxes size={28} />
            <h2>No monitors configured</h2>
            <p>Create a machine or service monitor to begin collecting status.</p>
            <Button onclick={() => (window.location.href = `/${data.workspace.slug}/admin`)}
              ><Plus size={14} />Add first monitor</Button
            >
          </section>
        {/if}
      </main>
    </div>
  </div>
</Tooltip.Provider>

<style>
  .shell {
    display: grid;
    min-height: 100dvh;
    grid-template-columns: 216px minmax(0, 1fr);
  }

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
    color: white;
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 750;
  }

  .brand strong {
    font-size: 13px;
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

  .workspace {
    min-width: 0;
  }

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

  .content {
    padding: 20px 22px 40px;
  }

  .page-header,
  .section__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 21px;
    line-height: 1.2;
  }

  .page-header p {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(7, minmax(90px, 1fr));
    margin: 20px 0 24px;
    padding: 14px 0;
    border-block: 1px solid var(--border);
  }

  .summary :global(.metric) {
    padding: 0 14px;
    border-right: 1px solid var(--border);
  }

  .summary :global(.metric:first-child) {
    padding-left: 0;
  }

  .summary :global(.metric:last-child) {
    border-right: 0;
  }

  .section {
    margin-top: 26px;
  }

  .section__header {
    margin-bottom: 10px;
  }

  .section__header div {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .section__header h2 {
    font-size: 14px;
  }

  .section__header span,
  .section__header a {
    color: var(--text-faint);
    font-size: 10px;
  }

  .section__header a {
    color: var(--accent);
    text-decoration: none;
  }

  .machine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr));
    gap: 10px;
  }

  .empty {
    display: grid;
    max-width: 480px;
    justify-items: start;
    gap: 9px;
    margin: 56px auto;
    padding: 28px;
    border: 1px dashed var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
  }

  .empty :global(svg) {
    color: var(--text-faint);
  }

  .empty h2 {
    font-size: 15px;
  }

  .empty p {
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 12px;
  }

  @media (max-width: 1050px) {
    .summary {
      grid-template-columns: repeat(4, 1fr);
      row-gap: 18px;
    }

    .summary :global(.metric:nth-child(4)) {
      border-right: 0;
    }
  }

  @media (max-width: 780px) {
    .shell {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: fixed;
      left: 0;
      translate: -100% 0;
      width: 216px;
      transition: translate 140ms ease;
    }

    .sidebar.open {
      translate: 0 0;
    }

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

    .content {
      padding: 16px 12px 32px;
    }
  }

  @media (max-width: 560px) {
    .summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .summary :global(.metric) {
      padding: 0 10px;
    }

    .summary :global(.metric:nth-child(even)) {
      border-right: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none;
    }
  }
</style>
