<script lang="ts">
  import { Radio, TimerReset } from "lucide-svelte";

  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  type Check = {
    id: string;
    name: string;
    kind: "http" | "tcp" | "icmp";
    executorKind: "cloudflare" | "agent";
    intervalSeconds: number;
    failureConfirmations: number;
    recoveryConfirmations: number;
    target: string;
    assertionCount: number;
    state: "healthy" | "degraded" | "down" | "unknown";
    observedAt: number | null;
    latencyMs: number | null;
    failureCode: string | null;
    failureSummary: string | null;
  };

  let { checks }: { checks: readonly Check[] } = $props();
</script>

<section>
  <header>
    <div>
      <h2>Checks</h2>
      <span>{checks.length} configured</span>
    </div>
  </header>
  {#if checks.length > 0}
    <div class="table">
      {#each checks as check (check.id)}
        <article>
          <StatusLabel status={check.state} compact />
          <div class="main"><strong>{check.name}</strong><code>{check.target}</code></div>
          <span class="type">{check.kind.toUpperCase()} · {check.executorKind}</span>
          <span class="number">{check.latencyMs === null ? "—" : `${check.latencyMs} ms`}</span>
          <span class="muted">{formatRelativeTime(check.observedAt)}</span>
          <div class="detail">
            <span><Radio size={12} />every {check.intervalSeconds}s</span><span
              ><TimerReset size={12} />{check.failureConfirmations} fail / {check.recoveryConfirmations}
              recover</span
            ><span>{check.assertionCount} assertions</span>{#if check.failureCode}<span
                class="failure"
                >{check.failureCode}{check.failureSummary ? ` · ${check.failureSummary}` : ""}</span
              >{/if}
          </div>
        </article>
      {/each}
    </div>
  {:else}<p>No checks are configured for this service.</p>{/if}
</section>

<style>
  section {
    margin-top: 24px;
  }
  header {
    margin-bottom: 10px;
  }
  header > div {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: 14px;
  }
  header span {
    color: var(--text-faint);
    font-size: 10px;
  }
  .table {
    border-block: 1px solid var(--border);
  }
  article {
    display: grid;
    grid-template-columns: 24px minmax(180px, 1fr) 130px 80px 80px;
    align-items: center;
    gap: 10px;
    min-height: 66px;
    padding: 9px 0;
    border-top: 1px solid var(--border);
  }
  article:first-child {
    border-top: 0;
  }
  .main {
    min-width: 0;
  }
  .main strong,
  .main code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .main strong {
    font-size: 12px;
  }
  .main code {
    margin-top: 3px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .type,
  .number,
  .muted {
    font-size: 10px;
  }
  .type,
  .muted {
    color: var(--text-faint);
  }
  .number {
    font-family: var(--font-mono);
  }
  .detail {
    display: flex;
    grid-column: 2 / -1;
    gap: 14px;
    color: var(--text-faint);
    font-size: 9px;
  }
  .detail span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .detail .failure {
    color: var(--status-down);
  }
  section > p {
    margin-top: 3px;
    color: var(--text-faint);
    font-size: 10px;
  }
  @media (max-width: 760px) {
    article {
      grid-template-columns: 24px 1fr auto;
    }
    article > .number,
    article > .muted {
      display: none;
    }
    .detail {
      grid-column: 2 / -1;
      flex-wrap: wrap;
      gap: 6px 12px;
    }
  }
</style>
