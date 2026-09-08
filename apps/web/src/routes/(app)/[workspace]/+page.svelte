<script lang="ts">
  import { Boxes, Plus } from "@lucide/svelte";

  import Metric from "$components/dashboard/metric.svelte";
  import MachineCard from "$components/machines/machine-card.svelte";
  import ServiceRow from "$components/services/service-row.svelte";
  import Button from "$components/ui/button/button.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";
  import { formatBytes, formatRate } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head><title>{data.workspace.name} · AlphaPing</title></svelte:head>

<main class="content">
  <header class="page-header">
    <div>
      <h1>Overview</h1>
      <p>Machine health, service status and recent activity</p>
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
    {#if data.summary.services > 0}
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

  {#if data.summary.machines > 0}
    <section class="section">
      <header class="section__header">
        <div>
          <h2>Machines</h2>
          <span>Showing {data.machines.length} of {data.summary.machines}</span>
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

  {#if data.summary.services > 0}
    <section class="section">
      <header class="section__header">
        <div>
          <h2>Services</h2>
          <span>Showing {data.services.length} of {data.summary.services} · Last 150 minutes</span>
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

  {#if data.summary.machines === 0 && data.summary.services === 0}
    <EmptyState
      icon={Boxes}
      title={data.workspace.role === "admin" ? "No monitors configured" : "No monitors available"}
      description={data.workspace.role === "admin"
        ? "Create a machine or service monitor to begin collecting status."
        : "Your account does not currently have access to a machine or service."}
    >
      {#if data.workspace.role === "admin"}
        <Button onclick={() => (window.location.href = `/${data.workspace.slug}/admin`)}
          ><Plus size={14} />Add first monitor</Button
        >
      {/if}
    </EmptyState>
  {/if}
</main>

<style>
  .content {
    width: min(100% - 48px, var(--content-wide));
    margin: 0 auto;
    padding: var(--space-6) 0 var(--space-8);
  }

  .page-header,
  .section__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .page-header {
    padding-bottom: var(--space-4);
    border-bottom: 0;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }

  .page-header p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 24px 0 32px;
  }
  .summary :global(.metric) {
    min-width: 0;
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }
  .section {
    margin-top: var(--space-6);
  }

  .section__header {
    margin-bottom: var(--space-3);
  }

  .section__header div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .section__header h2 {
    font-size: 20px;
    font-weight: 600;
  }

  .section__header span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .section__header a {
    color: var(--accent);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .section__header a:hover {
    text-decoration: underline;
  }

  .machine-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: var(--space-4);
  }

  @media (max-width: 768px) {
    .content {
      width: min(100% - 32px, var(--content-wide));
    }
  }
  @media (max-width: 560px) {
    .content {
      width: min(100% - 32px, var(--content-wide));
      padding-top: 16px;
    }
    .summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .summary :global(.metric) {
      padding: 14px;
    }
  }
</style>
