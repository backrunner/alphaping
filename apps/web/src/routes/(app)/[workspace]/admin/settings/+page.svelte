<script lang="ts">
  import PublicAccessTable from "$components/admin/public-access-table.svelte";
  import RetentionSettingsForm from "$components/admin/retention-settings-form.svelte";
  import WorkspaceDangerZone from "$components/admin/workspace-danger-zone.svelte";

  let { data, form } = $props();
</script>

<svelte:head><title>Data & visibility · AlphaPing</title></svelte:head>

<main class="settings-page">
  {#if form?.message}<p class="action-error" role="alert">{form.message}</p>{/if}
  <PublicAccessTable
    workspace={data.workspace}
    visibility={data.settings.dashboardVisibility}
    resources={data.settings.resources}
    resourcePagination={data.settings.resourcePagination}
  />
  <RetentionSettingsForm
    retention={data.settings.retention}
    estimatedStorageGb={data.settings.estimatedStorageGb}
    estimatedStorageCapped={data.settings.estimatedStorageCapped}
  />
  <WorkspaceDangerZone name={data.shell.workspace.name} slug={data.workspace} />
</main>

<style>
  .settings-page {
    display: grid;
    gap: 24px;
    padding-bottom: 40px;
  }

  .action-error {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: 11px;
  }
</style>
