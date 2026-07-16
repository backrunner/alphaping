<script lang="ts">
  import AccessMemberTable from "$components/admin/access-member-table.svelte";
  import ResourceAccessTable from "$components/admin/resource-access-table.svelte";

  let { data, form } = $props();
  const invitationUrl = $derived(form?.kind === "invite" ? (form.invitationUrl ?? null) : null);
  const invitationExpiresAt = $derived(
    form?.kind === "invite" ? (form.invitationExpiresAt ?? null) : null,
  );
</script>

<svelte:head><title>Access · AlphaPing</title></svelte:head>

<main class="access-page">
  {#if form?.message}<p class="action-error" role="alert">{form.message}</p>{/if}
  <AccessMemberTable
    members={data.access.members}
    invitations={data.access.invitations}
    {invitationUrl}
    {invitationExpiresAt}
  />
  <ResourceAccessTable
    workspace={data.workspace}
    members={data.access.members}
    selectedMemberId={data.access.selectedMemberId}
    resources={data.access.resources}
  />
</main>

<style>
  .access-page {
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
