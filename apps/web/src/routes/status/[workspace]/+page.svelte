<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";

  import PublicSurface from "$components/status/public-surface.svelte";
  import PublicNavigation from "$components/status/public-navigation.svelte";
  import PublicAnnouncements from "$components/status/public-announcements.svelte";
  import PublicIncidentList from "$components/status/public-incident-list.svelte";
  import PublicMachineList from "$components/status/public-machine-list.svelte";
  import PublicServiceList from "$components/status/public-service-list.svelte";
  import PublicStatusHeader from "$components/status/public-status-header.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.dashboard.appearance?.title || data.workspace.name} Status · AlphaPing</title>
  <meta
    name="description"
    content={data.dashboard.appearance?.description ||
      `Current monitor availability for ${data.workspace.name}`}
  />
</svelte:head>

<PublicSurface appearance={data.dashboard.appearance} workspace={data.workspace.slug}>
  <main>
    <PublicNavigation
      workspace={data.workspace}
      title={data.dashboard.appearance?.title}
      logoUrl={data.dashboard.appearance?.logoUrl}
    />
    <PublicStatusHeader
      dashboard={data.dashboard}
      overallState={data.overallState}
      machineCount={data.machines.length}
      serviceCount={data.servicePagination.total}
      incidentCount={data.incidents.length}
    />
    {#if data.stale}
      <div class="stale-notice" role="status">
        <TriangleAlert size={15} />
        <span
          ><strong>Live status is temporarily unavailable.</strong> Showing the last verified
          snapshot from {formatRelativeTime(data.snapshotAt)}.</span
        >
      </div>
    {/if}
    <PublicAnnouncements announcements={data.announcements} />
    <PublicIncidentList incidents={data.incidents} />
    <PublicMachineList machines={data.machines} workspaceSlug={data.workspace.slug} />
    <PublicServiceList
      services={data.services}
      pagination={data.servicePagination}
      workspaceSlug={data.workspace.slug}
    />
    <footer>
      <span
        title={(data.stale ? data.snapshotAt : data.updatedAt) === null
          ? undefined
          : new Date((data.stale ? data.snapshotAt : data.updatedAt) as number).toLocaleString()}
        >{data.stale ? "Snapshot captured" : "Updated"}
        {formatRelativeTime(data.stale ? data.snapshotAt : data.updatedAt)}</span
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

  .stale-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    background: var(--status-degraded-bg);
    font-size: var(--text-xs);
    line-height: var(--leading-xs);
  }

  .stale-notice :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--status-degraded);
  }

  .stale-notice strong {
    color: var(--text);
  }

  @media (max-width: 768px) {
    main {
      padding: 0 24px 32px;
    }
  }

  @media (max-width: 480px) {
    main {
      padding: 0 18px 28px;
    }
  }
</style>
