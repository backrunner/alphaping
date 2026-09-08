<script lang="ts">
  import { page } from "$app/state";
  import { ChevronLeft, ChevronRight, Save, ShieldCheck } from "@lucide/svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import type {
    WorkspaceAccessMember,
    WorkspaceAccessPagination,
    WorkspaceAccessResource,
  } from "$lib/server/workspace-access";

  let {
    members,
    selectedMemberId,
    resources,
    pagination,
  }: {
    members: readonly WorkspaceAccessMember[];
    selectedMemberId: string | null;
    resources: readonly WorkspaceAccessResource[];
    pagination: WorkspaceAccessPagination;
  } = $props();
  const selectable = $derived(members.filter((member) => member.role === "member"));

  function memberHref(memberId: string): string {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    params.set("member", memberId);
    params.delete("resourcePage");
    const query = params.toString();
    return `${page.url.pathname}${query ? `?${query}` : ""}`;
  }

  function paginationHref(value: number): string {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    if (value <= 1) params.delete("resourcePage");
    else params.set("resourcePage", String(value));
    const query = params.toString();
    return `${page.url.pathname}${query ? `?${query}` : ""}`;
  }
</script>

<section aria-labelledby="resource-access-title">
  <header>
    <div>
      <h2 id="resource-access-title">Resource access</h2>
      <p>Explicit permissions for normal users</p>
    </div>
    {#if selectable.length > 0}
      <label
        ><span>Member</span><select
          onchange={(event) => location.assign(memberHref(event.currentTarget.value))}
        >
          {#each selectable as member (member.id)}<option
              value={member.id}
              selected={member.id === selectedMemberId}>{member.name}</option
            >{/each}
        </select></label
      >
    {/if}
  </header>

  {#if !selectedMemberId}
    <div class="empty">
      <ShieldCheck size={18} /><strong>No member accounts</strong><span
        >Invite a member before assigning resource access.</span
      >
    </div>
  {:else if resources.length === 0}
    <div class="empty">
      <ShieldCheck size={18} /><strong>No resources</strong><span
        >Add a machine or service first.</span
      >
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead
          ><tr
            ><th>Resource</th><th>Type</th><th>Permission</th><th
              ><span class="sr-only">Action</span></th
            ></tr
          ></thead
        >
        <tbody>
          {#each resources as resource (`${resource.type}:${resource.id}`)}
            <tr>
              <td><strong>{resource.name}</strong></td>
              <td><span class="type">{resource.type}</span></td>
              <td colspan="2">
                <form method="POST" action="?/grant">
                  <input type="hidden" name="memberId" value={selectedMemberId} />
                  <input type="hidden" name="resourceType" value={resource.type} />
                  <input type="hidden" name="resourceId" value={resource.id} />
                  <select name="permission" aria-label={`Permission for ${resource.name}`}>
                    <option value="none" selected={resource.permission === "none"}>No access</option
                    >
                    <option value="view" selected={resource.permission === "view"}>View</option>
                    <option value="manage" selected={resource.permission === "manage"}
                      >Manage</option
                    >
                    <option value="deny" selected={resource.permission === "deny"}
                      >Explicit deny</option
                    >
                  </select>
                  <button aria-label={`Save access for ${resource.name}`}><Save size={14} /></button
                  >
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if pagination.pages > 1}
      <nav class="pagination" aria-label="Workspace resource pages">
        {#if pagination.page > 1}
          <a href={paginationHref(pagination.page - 1)}><ChevronLeft size={13} />Previous</a>
        {:else}<span><ChevronLeft size={13} />Previous</span>{/if}
        <strong>
          Page {pagination.page} of {pagination.pages} · {pagination.total}{pagination.totalCapped
            ? "+"
            : ""} resources
        </strong>
        {#if pagination.page < pagination.pages}
          <a href={paginationHref(pagination.page + 1)}>Next<ChevronRight size={13} /></a>
        {:else}<span>Next<ChevronRight size={13} /></span>{/if}
      </nav>
    {/if}
  {/if}
</section>

<style>
  section {
    min-width: 0;
    padding-top: var(--space-6);
    border-top: 1px solid var(--border);
  }

  header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
  }

  p {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  select {
    height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
  }

  select:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    height: 44px;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  tbody tr {
    transition: background-color 120ms ease;
  }

  tbody tr:hover {
    background: var(--surface-subtle);
  }

  th {
    height: 34px;
    color: var(--text-faint);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  td {
    font-size: var(--text-sm);
  }

  td strong {
    font-weight: 620;
  }

  .type {
    padding: 3px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }

  form {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  form select {
    width: 130px;
  }

  form button {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background-color 120ms ease,
      color 120ms ease;
  }

  form button:hover {
    color: var(--text);
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: var(--space-3);
    font-size: var(--text-xs);
  }

  .pagination a,
  .pagination span {
    display: inline-flex;
    height: 32px;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
  }

  .pagination a {
    color: var(--text);
    background: var(--surface);
    text-decoration: none;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .pagination a:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .pagination span {
    color: var(--text-faint);
  }

  .pagination a:last-child,
  .pagination span:last-child {
    justify-self: end;
  }

  .pagination strong {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    display: grid;
    min-height: 120px;
    place-items: center;
    align-content: center;
    gap: var(--space-1);
    text-align: center;
  }

  .empty > :global(svg) {
    margin-bottom: var(--space-2);
    color: var(--text-faint);
  }

  .empty strong {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .empty span {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .sr-only {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  @media (prefers-reduced-motion: reduce) {
    tbody tr,
    form button,
    .pagination a {
      transition: none;
    }
  }
</style>
