<script lang="ts">
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
    machines={data.machines}
    services={data.services}
  />
  <PublicAnnouncements announcements={data.announcements} />
  <PublicMachineList machines={data.machines} />
  <PublicServiceList services={data.services} />
  <PublicIncidentList incidents={data.incidents} />
  <footer>
    <span>Updated {formatRelativeTime(data.updatedAt)}</span><span>Powered by AlphaPing</span>
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
</style>
