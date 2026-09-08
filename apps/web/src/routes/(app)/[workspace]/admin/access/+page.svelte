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
    memberPagination={data.access.memberPagination}
    invitationPagination={data.access.invitationPagination}
    {invitationUrl}
    {invitationExpiresAt}
  />
  <ResourceAccessTable
    members={data.access.members}
    selectedMemberId={data.access.selectedMemberId}
    resources={data.access.resources}
    pagination={data.access.resourcePagination}
  />
</main>

<style>
  .access-page {
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
