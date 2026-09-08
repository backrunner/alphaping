<script lang="ts">
  import PublicSurface from "$components/status/public-surface.svelte";
  import PublicNavigation from "$components/status/public-navigation.svelte";
  import { ArrowLeft, Box, Cpu, HardDrive, MemoryStick, Network, Radio } from "@lucide/svelte";

  import StatusLabel from "$components/status/status-label.svelte";
  import { formatBytes, formatPercent, formatRate, formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head>
  <title
    >{data.machine.name} status · {data.dashboard.appearance?.title || data.workspace.name}</title
  >
  <meta name="description" content={`Current public machine status for ${data.machine.name}`} />
</svelte:head>

<PublicSurface appearance={data.dashboard.appearance} workspace={data.workspace.slug}>
  <main>
    <PublicNavigation
      workspace={data.workspace}
      title={data.dashboard.appearance?.title}
      logoUrl={data.dashboard.appearance?.logoUrl}
    />
    <a class="back" href={`/status/${data.workspace.slug}/machines`}
      ><ArrowLeft size={15} />All machines</a
    >
    <header class="resource-header">
      <div>
        <h1>{data.machine.name}</h1>
        {#if data.machine.description}<p>{data.machine.description}</p>{/if}
      </div>
      <StatusLabel status={data.machine.state} />
    </header>

    {#if data.machine.cpuPermille !== null}
      <section class="metric-grid" aria-label="Published machine metrics">
        <div>
          <span><Cpu size={14} />CPU</span><strong>{formatPercent(data.machine.cpuPermille)}</strong
          >
          <small>current utilization</small>
        </div>
        <div>
          <span><MemoryStick size={14} />Memory</span>
          <strong>{formatBytes(data.machine.memoryUsedBytes ?? 0)}</strong>
          <small>of {formatBytes(data.machine.memoryTotalBytes ?? 0)}</small>
        </div>
        <div>
          <span><HardDrive size={14} />Storage</span>
          <strong>{formatBytes(data.machine.storageUsedBytes ?? 0)}</strong>
          <small>of {formatBytes(data.machine.storageTotalBytes ?? 0)}</small>
        </div>
        <div>
          <span><Network size={14} />Download</span>
          <strong>{formatRate(data.machine.networkRxBps ?? 0)}</strong>
          <small>{formatRate(data.machine.networkTxBps ?? 0)} up</small>
        </div>
      </section>
    {:else}
      <section class="summary-only">
        <Radio size={18} />
        <div>
          <strong>Summary status only</strong><span>Resource metrics are not published.</span>
        </div>
      </section>
    {/if}

    {#if data.machine.containers.length > 0}
      <section class="containers" aria-labelledby="containers-title">
        <header>
          <div>
            <h2 id="containers-title">Containers</h2>
            <p>Explicitly published workloads</p>
          </div>
          <span>{data.machine.containers.length}</span>
        </header>
        <div class="container-list">
          {#each data.machine.containers as container (container.name)}
            <article>
              <Box size={15} />
              <div>
                <strong>{container.name}</strong><span>{container.state} · {container.health}</span>
              </div>
              {#if container.cpuPermille !== null}
                <small
                  >{formatPercent(container.cpuPermille)} · {formatBytes(
                    container.memoryUsedBytes ?? 0,
                  )}</small
                >
              {/if}
            </article>
          {/each}
        </div>
      </section>
    {/if}

    <footer>
      <span title={data.updatedAt === null ? undefined : new Date(data.updatedAt).toLocaleString()}
        >Updated {formatRelativeTime(data.updatedAt)}</span
      ><span>Powered by AlphaPing</span>
    </footer>
  </main>
</PublicSurface>

<style>
  main {
    max-width: var(--content-narrow);
    margin: 0 auto;
    padding: 0 32px 40px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .back:hover {
    color: var(--accent);
  }

  .resource-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-top: 24px;
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: linear-gradient(120deg, var(--surface), var(--accent-soft));
    box-shadow: var(--shadow-panel);
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    margin-top: var(--space-1);
    font-size: 34px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .resource-header p {
    max-width: 64ch;
    margin-top: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-base);
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-top: var(--space-6);
  }

  .metric-grid > div {
    min-width: 0;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .metric-grid span,
  .metric-grid strong,
  .metric-grid small {
    display: flex;
  }

  .metric-grid span {
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .metric-grid strong {
    margin-top: 16px;
    font-family: var(--font-mono);
    font-size: 26px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .metric-grid small {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .summary-only {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-6);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    color: var(--text-faint);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .summary-only strong,
  .summary-only span {
    display: block;
  }

  .summary-only strong {
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .summary-only span {
    margin-top: var(--space-1);
    font-size: var(--text-xs);
  }

  .containers {
    margin-top: var(--space-8);
  }

  .containers > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .containers h2 {
    font-size: var(--text-base);
    font-weight: 600;
  }

  .containers p,
  .containers > header > span {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .container-list {
    border-block: 1px solid var(--border);
  }

  .container-list article {
    display: grid;
    min-height: 52px;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
  }

  .container-list article:last-child {
    border-bottom: 0;
  }

  .container-list strong,
  .container-list span {
    display: block;
  }

  .container-list strong {
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .container-list span,
  .container-list small {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .container-list small {
    margin-top: 0;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-8);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  @media (max-width: 768px) {
    main {
      padding: 0 24px 32px;
    }
  }

  @media (max-width: 700px) {
    .metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metric-grid {
      gap: 12px;
    }
    .metric-grid > div {
      padding: 18px;
    }
    .metric-grid strong {
      font-size: 22px;
    }
  }

  @media (max-width: 480px) {
    main {
      padding: 0 18px 28px;
    }

    .resource-header {
      padding: 24px;
      align-items: flex-start;
      flex-direction: column;
    }
  }
  @media (max-width: 360px) {
    .metric-grid > div {
      padding: 14px;
    }
    .metric-grid strong {
      font-size: 18px;
    }
    h1 {
      font-size: 28px;
    }
  }
</style>
