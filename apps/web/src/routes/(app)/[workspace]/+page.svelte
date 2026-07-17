<script lang="ts">
  import { Boxes, Plus } from "lucide-svelte";

  import Metric from "$components/dashboard/metric.svelte";
  import MachineCard from "$components/machines/machine-card.svelte";
  import ServiceRow from "$components/services/service-row.svelte";
  import Button from "$components/ui/button/button.svelte";
  import { formatBytes, formatRate } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head><title>{data.workspace.name} · AlphaPing</title></svelte:head>

<main class="content">
  <header class="page-header">
    <div>
      <h1>Overview</h1>
      <p>Updated from durable telemetry and live connections</p>
    </div>
    {#if data.workspace.role === "admin"}
      <Button onclick={() => (window.location.href = `/${data.workspace.slug}/admin`)}
        ><Plus size={14} />Add monitor</Button
      >
    {/if}
  </header>

  <section class="summary" aria-label="Monitoring summary">
    <Metric
      label="Machines"
      value={data.summary.machines}
      href={`/${data.workspace.slug}/machines`}
    />
    <Metric
      label="Online"
      value={data.summary.online}
      tone="healthy"
      href={`/${data.workspace.slug}/machines?status=online`}
    />
    <Metric
      label="Impaired"
      value={data.summary.impaired}
      tone={data.summary.impaired > 0 ? "danger" : "default"}
      href={`/${data.workspace.slug}/machines?status=impaired`}
    />
    <Metric
      label="Offline"
      value={data.summary.offline}
      tone={data.summary.offline > 0 ? "danger" : "default"}
      href={`/${data.workspace.slug}/machines?status=offline`}
    />
    <Metric
      label="Download"
      value={formatRate(data.summary.networkRxBps)}
      detail={formatBytes(data.summary.networkRxTotal)}
      href={`/${data.workspace.slug}/machines?sort=download`}
    />
    <Metric
      label="Upload"
      value={formatRate(data.summary.networkTxBps)}
      detail={formatBytes(data.summary.networkTxTotal)}
      href={`/${data.workspace.slug}/machines?sort=upload`}
    />
    {#if data.services.length > 0}
      <Metric
        label="Service faults"
        value={data.summary.servicesDown}
        tone={data.summary.servicesDown > 0 ? "danger" : "default"}
        href={`/${data.workspace.slug}/services?status=down`}
      />
    {/if}
    <Metric
      label="Active incidents"
      value={data.summary.activeIncidents}
      tone={data.summary.activeIncidents > 0 ? "danger" : "default"}
      href={`/${data.workspace.slug}/incidents?state=active`}
    />
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
      {#if data.workspace.role === "admin"}
        <h2>No monitors configured</h2>
        <p>Create a machine or service monitor to begin collecting status.</p>
        <Button onclick={() => (window.location.href = `/${data.workspace.slug}/admin`)}
          ><Plus size={14} />Add first monitor</Button
        >
      {:else}
        <h2>No monitors available</h2>
        <p>Your account does not currently have access to a machine or service.</p>
      {/if}
    </section>
  {/if}
</main>

<style>
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
    grid-template-columns: repeat(8, minmax(90px, 1fr));
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

    .summary :global(.metric:nth-child(8)) {
      border-right: 0;
    }
  }

  @media (max-width: 780px) {
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
</style>
