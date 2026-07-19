<script lang="ts">
  import { TriangleAlert } from "lucide-svelte";

  import PublicAnnouncements from "$components/status/public-announcements.svelte";
  import PublicIncidentList from "$components/status/public-incident-list.svelte";
  import PublicMachineList from "$components/status/public-machine-list.svelte";
  import PublicServiceList from "$components/status/public-service-list.svelte";
  import PublicStatusHeader from "$components/status/public-status-header.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.workspace.name} Status · AlphaPing</title>
  <meta name="description" content={`Current monitor availability for ${data.workspace.name}`} />
</svelte:head>

<main>
  <PublicStatusHeader
    workspace={data.workspace}
    dashboard={data.dashboard}
    overallState={data.overallState}
  />
  {#if data.stale}
    <div class="stale-notice" role="status">
      <TriangleAlert size={15} />
      <span
        ><strong>Live status is temporarily unavailable.</strong> Showing the last verified snapshot
        from {formatRelativeTime(data.snapshotAt)}.</span
      >
    </div>
  {/if}
  <PublicAnnouncements announcements={data.announcements} />
  <PublicIncidentList incidents={data.incidents} />
  <PublicMachineList machines={data.machines} />
  <PublicServiceList services={data.services} pagination={data.servicePagination} />
  <footer>
    <span
      >{data.stale ? "Snapshot captured" : "Updated"}
      {formatRelativeTime(data.stale ? data.snapshotAt : data.updatedAt)}</span
    ><span>Powered by AlphaPing</span>
  </footer>
</main>

<style>
  main {
    width: min(100% - 24px, 920px);
    margin: 0 auto;
    padding: 24px 0 32px;
  }

  footer {
    display: flex;
    justify-content: space-between;
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 9px;
  }

  .stale-notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 20px;
    padding: 9px 10px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--status-degraded-bg);
    font-size: 10px;
  }

  .stale-notice :global(svg) {
    flex: none;
    color: var(--status-degraded);
  }

  .stale-notice strong {
    color: var(--text);
  }
</style>
