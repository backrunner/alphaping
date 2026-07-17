<script lang="ts">
  import { Ban, ExternalLink, KeyRound, RefreshCw } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";
  import EnrollmentCommand from "$components/machines/enrollment-command.svelte";

  type Token = {
    id: string;
    expiresAt: number;
    usedAt: number | null;
    revokedAt: number | null;
    createdAt: number;
    state: "active" | "used" | "revoked" | "expired";
  };

  let {
    machineId,
    tokens,
    result,
    ingestOrigin,
    installOrigin,
    checksums,
    manageHref,
  }: {
    machineId: string;
    tokens: readonly Token[];
    result: Record<string, unknown> | null;
    ingestOrigin: string;
    installOrigin: string;
    checksums: Record<"unix" | "windows", string>;
    manageHref: string;
  } = $props();
  const hasActiveToken = $derived(tokens.some((token) => token.state === "active"));

  function formatUtc(timestamp: number): string {
    return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
</script>

{#if result?.kind === "enrollment" && result.enrollment}
  {@const enrollment = result.enrollment as {
    machineId: string;
    tokenId: string;
    token: string;
    expiresAt: number;
  }}
  <EnrollmentCommand
    machineId={enrollment.machineId}
    tokenId={enrollment.tokenId}
    token={enrollment.token}
    expiresAt={enrollment.expiresAt}
    {ingestOrigin}
    {installOrigin}
    {checksums}
    {manageHref}
  />
{/if}

<section class="tokens">
  <header>
    <div>
      <h2>Agent enrollment</h2>
      <p>Tokens expire after 15 minutes and can be consumed only once.</p>
    </div>
    <form method="POST" action="?/regenerateEnrollment">
      <Button type="submit" variant="secondary"
        ><RefreshCw size={13} />{hasActiveToken ? "Replace token" : "Generate token"}</Button
      >
    </form>
  </header>

  {#if result?.kind === "enrollment" && result.message}
    <p class="feedback feedback--error" role="alert">{String(result.message)}</p>
  {:else if result?.kind === "enrollment" && result.revoked}
    <p class="feedback" role="status">Enrollment token revoked.</p>
  {/if}

  <div class="installers" aria-label="Installer scripts">
    <span>Installer scripts</span>
    <a href={`${installOrigin}/install.sh`} target="_blank" rel="noreferrer"
      ><ExternalLink size={12} />Shell</a
    >
    <code>SHA-256 {checksums.unix}</code>
    <a href={`${installOrigin}/install.ps1`} target="_blank" rel="noreferrer"
      ><ExternalLink size={12} />PowerShell</a
    >
    <code>SHA-256 {checksums.windows}</code>
  </div>

  <div class="token-list">
    <div class="token-list__heading">
      <span>Token ID</span><span>Validity</span><span>Status</span>
    </div>
    {#each tokens as token (token.id)}
      <div class="token-list__row">
        <div><KeyRound size={13} /><code>{token.id}</code></div>
        <div>
          <span>Created {formatUtc(token.createdAt)}</span>
          <span>Expires {formatUtc(token.expiresAt)}</span>
        </div>
        <div class="token-state">
          <span class:active={token.state === "active"}>{token.state}</span>
          {#if token.state === "active" || token.state === "expired"}
            <form method="POST" action="?/revokeEnrollment">
              <input type="hidden" name="tokenId" value={token.id} />
              <Button type="submit" variant="ghost"><Ban size={13} />Revoke</Button>
            </form>
          {/if}
        </div>
      </div>
    {:else}
      <p class="empty">No enrollment tokens have been issued.</p>
    {/each}
  </div>
</section>

<style>
  .tokens {
    max-width: 900px;
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }

  header,
  .token-list__heading,
  .token-list__row,
  .token-list__row > div,
  .token-state {
    display: flex;
    align-items: center;
  }

  header {
    justify-content: space-between;
    gap: 12px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
  }

  header p,
  .empty {
    color: var(--text-muted);
    font-size: 10px;
  }

  .feedback {
    margin-top: 10px;
    color: var(--status-healthy);
    font-size: 10px;
  }

  .feedback--error {
    color: var(--status-down);
  }

  .installers {
    display: flex;
    min-width: 0;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin-top: 12px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .installers > span {
    color: var(--text-faint);
    font-size: 9px;
    text-transform: uppercase;
  }

  .installers a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
  }

  .installers code {
    overflow: hidden;
    max-width: min(100%, 430px);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .token-list {
    margin-top: 14px;
    border-top: 1px solid var(--border);
  }

  .token-list__heading,
  .token-list__row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(210px, auto) 150px;
    gap: 16px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
  }

  .token-list__heading {
    color: var(--text-faint);
    font-size: 9px;
    text-transform: uppercase;
  }

  .token-list__row > div:first-child {
    min-width: 0;
    gap: 7px;
  }

  .token-list__row code {
    overflow: hidden;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .token-list__row > div:nth-child(2) {
    align-items: flex-start;
    flex-direction: column;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 9px;
  }

  .token-state {
    justify-content: space-between;
    gap: 4px;
  }

  .token-state > span {
    color: var(--text-muted);
    font-size: 10px;
    text-transform: capitalize;
  }

  .token-state > span.active {
    color: var(--status-healthy);
  }

  .empty {
    padding: 14px 0;
  }

  @media (max-width: 700px) {
    .token-list__heading {
      display: none;
    }

    .token-list__row {
      grid-template-columns: 1fr auto;
      gap: 6px 12px;
      padding-block: 10px;
    }

    .token-list__row > div:nth-child(2) {
      grid-column: 1;
      grid-row: 2;
    }

    .token-state {
      grid-column: 2;
      grid-row: 1 / span 2;
    }
  }

  @media (max-width: 440px) {
    header {
      align-items: stretch;
      flex-direction: column;
    }

    .token-list__row {
      grid-template-columns: minmax(0, 1fr);
    }

    .token-state {
      grid-column: 1;
      grid-row: 3;
      justify-content: flex-start;
    }
  }
</style>
