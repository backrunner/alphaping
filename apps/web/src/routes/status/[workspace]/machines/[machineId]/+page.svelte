<script lang="ts">
  import { ArrowLeft, Box, Cpu, HardDrive, MemoryStick, Network, Radio } from "lucide-svelte";

  import StatusLabel from "$components/status/status-label.svelte";
  import { formatBytes, formatPercent, formatRate, formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.machine.name} status · {data.workspace.name}</title>
  <meta name="description" content={`Current public machine status for ${data.machine.name}`} />
</svelte:head>

<main>
  <a class="back" href={`/status/${data.workspace.slug}`}><ArrowLeft size={15} />All status</a>
  <header class="resource-header">
    <div>
      <span class="workspace">{data.workspace.name}</span>
      <h1>{data.machine.name}</h1>
      {#if data.machine.description}<p>{data.machine.description}</p>{/if}
    </div>
    <StatusLabel status={data.machine.state} />
  </header>

  {#if data.machine.cpuPermille !== null}
    <section class="metric-grid" aria-label="Published machine metrics">
      <div>
        <span><Cpu size={15} />CPU</span><strong>{formatPercent(data.machine.cpuPermille)}</strong>
      </div>
      <div>
        <span><MemoryStick size={15} />Memory</span>
        <strong>{formatBytes(data.machine.memoryUsedBytes ?? 0)}</strong>
        <small>of {formatBytes(data.machine.memoryTotalBytes ?? 0)}</small>
      </div>
      <div>
        <span><HardDrive size={15} />Storage</span>
        <strong>{formatBytes(data.machine.storageUsedBytes ?? 0)}</strong>
        <small>of {formatBytes(data.machine.storageTotalBytes ?? 0)}</small>
      </div>
      <div>
        <span><Network size={15} />Network</span>
        <strong>{formatRate(data.machine.networkRxBps ?? 0)} down</strong>
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
    <span>Updated {formatRelativeTime(data.updatedAt)}</span><span>Powered by AlphaPing</span>
  </footer>
</main>

<style>
  main {
    width: min(100% - 28px, 920px);
    margin: 0 auto;
    padding: 30px 0 36px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
    text-decoration: none;
  }

  .back:hover {
    color: var(--accent);
  }

  .resource-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-top: 22px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--border);
  }

  .workspace {
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 650;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    margin-top: 5px;
    font-size: 26px;
  }

  .resource-header p {
    max-width: 64ch;
    margin-top: 6px;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-top: 24px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .metric-grid > div {
    min-width: 0;
    padding: 16px;
    border-right: 1px solid var(--border);
  }

  .metric-grid > div:last-child {
    border-right: 0;
  }

  .metric-grid span,
  .metric-grid strong,
  .metric-grid small {
    display: flex;
  }

  .metric-grid span {
    align-items: center;
    gap: 7px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .metric-grid strong {
    margin-top: 9px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric-grid small {
    margin-top: 3px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .summary-only {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 24px;
    padding: 16px;
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
    font-size: 13px;
  }

  .summary-only span {
    margin-top: 2px;
    font-size: 12px;
  }

  .containers {
    margin-top: 30px;
  }

  .containers > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .containers h2 {
    font-size: 16px;
  }

  .containers p,
  .containers > header > span {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .container-list {
    border-block: 1px solid var(--border);
  }

  .container-list article {
    display: grid;
    min-height: 54px;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border);
  }

  .container-list article:last-child {
    border-bottom: 0;
  }

  .container-list strong,
  .container-list span {
    display: block;
  }

  .container-list strong {
    font-size: 13px;
  }

  .container-list span,
  .container-list small {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 11px;
  }

  footer {
    display: flex;
    justify-content: space-between;
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11px;
  }

  @media (max-width: 700px) {
    .metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metric-grid > div:nth-child(2) {
      border-right: 0;
    }

    .metric-grid > div:nth-child(-n + 2) {
      border-bottom: 1px solid var(--border);
    }
  }

  @media (max-width: 460px) {
    .resource-header {
      flex-direction: column;
    }

    footer {
      flex-direction: column;
      gap: 4px;
    }
  }
</style>
