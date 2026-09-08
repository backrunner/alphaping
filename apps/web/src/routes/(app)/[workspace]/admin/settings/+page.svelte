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
    gap: var(--space-6);
    padding-bottom: var(--space-8);
  }

  .action-error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
  }
</style>
