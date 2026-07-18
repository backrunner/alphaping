<script lang="ts">
  import { Save, ShieldCheck } from "lucide-svelte";

  import type {
    WorkspaceAccessMember,
    WorkspaceAccessResource,
  } from "$lib/server/workspace-access";

  let {
    workspace,
    members,
    selectedMemberId,
    resources,
  }: {
    workspace: string;
    members: readonly WorkspaceAccessMember[];
    selectedMemberId: string | null;
    resources: readonly WorkspaceAccessResource[];
  } = $props();
  const selectable = $derived(members.filter((member) => member.role === "member"));
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
          onchange={(event) =>
            location.assign(
              `/${workspace}/admin/access?member=${encodeURIComponent(event.currentTarget.value)}`,
            )}
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
  {/if}
</section>

<style>
  section {
    min-width: 0;
    padding-top: 24px;
    border-top: 1px solid var(--border);
  }

  header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 15px;
  }

  p,
  .empty span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-muted);
    font-size: 10px;
  }

  select {
    height: 28px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }

  select:focus {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }

  .table-wrap {
    overflow-x: auto;
    border-top: 1px solid var(--border);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    height: 40px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  th {
    height: 30px;
    color: var(--text-muted);
    font-size: 10px;
  }

  td {
    font-size: 11px;
  }

  .type {
    padding: 3px 6px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: 9px;
    text-transform: capitalize;
  }

  form {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  form select {
    width: 126px;
  }

  form button {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-muted);
    background: var(--surface);
    cursor: pointer;
  }

  form button:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }

  .empty {
    display: grid;
    min-height: 120px;
    place-items: center;
    align-content: center;
    text-align: center;
  }

  .empty > :global(svg) {
    margin-bottom: 8px;
    color: var(--text-faint);
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
</style>
