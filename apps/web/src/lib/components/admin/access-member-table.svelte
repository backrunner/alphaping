<script lang="ts">
  import { Copy, RotateCcw, Save, UserPlus } from "lucide-svelte";

  import type {
    WorkspaceAccessInvitation,
    WorkspaceAccessMember,
  } from "$lib/server/workspace-access";
  import Button from "$components/ui/button/button.svelte";

  let {
    members,
    invitations,
    invitationUrl,
    invitationExpiresAt,
  }: {
    members: readonly WorkspaceAccessMember[];
    invitations: readonly WorkspaceAccessInvitation[];
    invitationUrl: string | null;
    invitationExpiresAt: number | null;
  } = $props();
  let copied = $state(false);

  async function copyInvitation(): Promise<void> {
    if (!invitationUrl) return;
    await navigator.clipboard.writeText(invitationUrl);
    copied = true;
    setTimeout(() => (copied = false), 1_500);
  }
</script>

<section aria-labelledby="members-title">
  <header class="section-header">
    <div>
      <h2 id="members-title">Members</h2>
      <p>{members.length} workspace accounts</p>
    </div>
  </header>

  <form class="invite-form" method="POST" action="?/invite">
    <label
      ><span>Email</span><input
        type="email"
        name="email"
        required
        maxlength="254"
        autocomplete="off"
      /></label
    >
    <label
      ><span>Role</span><select name="role"
        ><option value="member">Member</option><option value="admin">Administrator</option></select
      ></label
    >
    <Button type="submit"><UserPlus size={14} />Invite</Button>
  </form>

  {#if invitationUrl}
    <div class="invite-result" aria-live="polite">
      <div>
        <strong>Invitation ready</strong><span
          >Expires {new Date(invitationExpiresAt ?? 0).toLocaleString()}</span
        >
      </div>
      <code>{invitationUrl}</code>
      <Button variant="secondary" onclick={copyInvitation}
        ><Copy size={14} />{copied ? "Copied" : "Copy"}</Button
      >
    </div>
  {/if}

  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>Account</th><th>Role</th><th>Status</th><th><span class="sr-only">Action</span></th
          ></tr
        ></thead
      >
      <tbody>
        {#each members as member (member.id)}
          <tr>
            <td
              ><strong>{member.name}</strong><span
                >{member.email}{member.current ? " · you" : ""}</span
              ></td
            >
            <td colspan="3">
              <form class="member-form" method="POST" action="?/membership">
                <input type="hidden" name="memberId" value={member.id} />
                <select
                  name="role"
                  aria-label={`Role for ${member.name}`}
                  disabled={member.current}
                >
                  <option value="admin" selected={member.role === "admin"}>Administrator</option>
                  <option value="member" selected={member.role === "member"}>Member</option>
                </select>
                <select
                  name="status"
                  aria-label={`Status for ${member.name}`}
                  disabled={member.current}
                >
                  <option value="active" selected={member.status === "active"}>Active</option>
                  <option value="suspended" selected={member.status === "suspended"}
                    >Suspended</option
                  >
                </select>
                <button
                  class="icon-action"
                  aria-label={`Save ${member.name}`}
                  disabled={member.current}><Save size={14} /></button
                >
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if invitations.length > 0}
    <div class="pending">
      <h3>Pending invitations</h3>
      {#each invitations as invitation (invitation.id)}
        <div class="pending__row">
          <div>
            <strong>{invitation.email}</strong><span
              >{invitation.role} · {invitation.expired
                ? "expired"
                : `expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}</span
            >
          </div>
          <form method="POST" action="?/revokeInvite">
            <input type="hidden" name="invitationId" value={invitation.id} />
            <button class="icon-action" aria-label={`Revoke invitation for ${invitation.email}`}
              ><RotateCcw size={14} /></button
            >
          </form>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  section {
    min-width: 0;
  }

  .section-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 15px;
  }

  h3 {
    margin-bottom: 8px;
    font-size: 12px;
  }

  p,
  td span,
  .pending span,
  .invite-result span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .invite-form {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 150px auto;
    align-items: end;
    gap: 8px;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }

  label span {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
  }

  input,
  select {
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 11px;
  }

  input:focus,
  select:focus {
    border-color: var(--accent);
    outline: 2px solid color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .invite-result {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    padding: 10px;
    border: 1px solid var(--status-healthy);
    border-radius: 6px;
    background: var(--status-healthy-bg);
  }

  .invite-result code {
    overflow: hidden;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    height: 44px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  th {
    height: 32px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
  }

  td {
    font-size: 11px;
  }

  .member-form {
    display: grid;
    grid-template-columns: 150px 120px 28px;
    justify-content: end;
    gap: 6px;
  }

  .icon-action {
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

  .icon-action:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }

  .icon-action:disabled,
  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pending {
    padding-top: 18px;
  }

  .pending__row {
    display: flex;
    min-height: 42px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    font-size: 11px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  @media (max-width: 680px) {
    .invite-form {
      grid-template-columns: 1fr 120px;
    }

    .invite-form > :global(button) {
      grid-column: 1 / -1;
      justify-self: start;
    }

    .invite-result {
      grid-template-columns: 1fr auto;
    }

    .invite-result code {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>
