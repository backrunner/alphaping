<script lang="ts">
  import { Radio, Save, Settings2, ShieldAlert, TimerReset, Trash2 } from "lucide-svelte";

  import CheckHistoryPanel from "$components/services/check-history-panel.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  type Check = {
    id: string;
    name: string;
    kind: "http" | "tcp" | "icmp";
    executorKind: "cloudflare" | "agent";
    intervalSeconds: number;
    timeoutMs: number;
    retryCount: number;
    critical: boolean;
    enabled: boolean;
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

  let {
    checks,
    canManage,
    result,
    historyBase,
  }: {
    checks: readonly Check[];
    canManage: boolean;
    historyBase: string;
    result: {
      kind?: string;
      checkId?: string;
      saved?: boolean;
      deleted?: boolean;
      message?: string;
    } | null;
  } = $props();
</script>

<section>
  <header>
    <div>
      <h2>Checks</h2>
      <span
        >{checks.filter((check) => check.enabled).length} active / {checks.length} configured</span
      >
    </div>
  </header>
  {#if result?.kind === "checkPolicy" && result.deleted}
    <p class="section-message" role="status">Check deleted.</p>
  {/if}
  {#if checks.length > 0}
    <div class="table">
      {#each checks as check (check.id)}
        <article class:disabled={!check.enabled}>
          <StatusLabel status={check.state} compact />
          <div class="main">
            <strong
              >{check.name}{#if check.critical}<ShieldAlert
                  size={11}
                  aria-label="Critical check"
                />{/if}</strong
            ><code>{check.target}</code>
          </div>
          <span class="type">{check.kind.toUpperCase()} · {check.executorKind}</span>
          <span class="number"
            >{check.latencyMs === null ? "No data" : `${check.latencyMs} ms`}</span
          >
          <span class="muted"
            >{check.enabled ? formatRelativeTime(check.observedAt) : "Disabled"}</span
          >
          <div class="detail">
            <span><Radio size={12} />every {check.intervalSeconds}s</span><span
              ><TimerReset size={12} />{check.failureConfirmations} fail / {check.recoveryConfirmations}
              recover</span
            ><span>{check.retryCount} retries</span><span>{check.assertionCount} assertions</span
            >{#if check.failureCode}<span class="failure"
                >{check.failureCode}{check.failureSummary ? ` · ${check.failureSummary}` : ""}</span
              >{/if}
          </div>
          <CheckHistoryPanel endpoint={`${historyBase}/${encodeURIComponent(check.id)}/history`} />
          {#if canManage}
            <details class="policy">
              <summary><Settings2 size={12} />Policy</summary>
              <form method="POST" action="?/updateCheckPolicy">
                <input type="hidden" name="checkId" value={check.id} />
                {#if result?.kind === "checkPolicy" && result.checkId === check.id && result.message}
                  <p class="policy__message policy__message--error" role="alert">
                    {result.message}
                  </p>
                {:else if result?.kind === "checkPolicy" && result.checkId === check.id && result.saved}
                  <p class="policy__message" role="status">Policy saved.</p>
                {/if}
                <div class="policy__fields">
                  <label
                    ><span>Interval, seconds</span><input
                      type="number"
                      name="intervalSeconds"
                      min={check.executorKind === "cloudflare" ? 60 : 5}
                      max="86400"
                      value={check.intervalSeconds}
                      required
                    /></label
                  ><label
                    ><span>Timeout, ms</span><input
                      type="number"
                      name="timeoutMs"
                      min="100"
                      max="30000"
                      value={check.timeoutMs}
                      required
                    /></label
                  ><label
                    ><span>Retries</span><input
                      type="number"
                      name="retryCount"
                      min="0"
                      max="3"
                      value={check.retryCount}
                      required
                    /></label
                  ><label
                    ><span>Failure count</span><input
                      type="number"
                      name="failureConfirmations"
                      min="1"
                      max="20"
                      value={check.failureConfirmations}
                      required
                    /></label
                  ><label
                    ><span>Recovery count</span><input
                      type="number"
                      name="recoveryConfirmations"
                      min="1"
                      max="20"
                      value={check.recoveryConfirmations}
                      required
                    /></label
                  >
                </div>
                <footer>
                  <label class="inline-check"
                    ><input type="checkbox" name="enabled" checked={check.enabled} /><span
                      >Enabled</span
                    ></label
                  ><input type="hidden" name="enabled" value="off" /><label class="inline-check"
                    ><input type="checkbox" name="critical" checked={check.critical} /><span
                      >Critical check</span
                    ></label
                  ><input type="hidden" name="critical" value="off" /><button
                    class="delete"
                    type="submit"
                    formaction="?/deleteCheck"
                    onclick={(event) => {
                      if (!window.confirm(`Delete ${check.name}? This cannot be undone.`)) {
                        event.preventDefault();
                      }
                    }}><Trash2 size={12} />Delete</button
                  ><button type="submit"><Save size={12} />Save policy</button>
                </footer>
              </form>
            </details>
          {/if}
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
  article.disabled > :not(.policy) {
    opacity: 0.58;
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
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
  }
  .main strong :global(svg) {
    flex: none;
    color: var(--status-down);
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
  .policy {
    grid-column: 2 / -1;
  }
  .policy summary {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--accent);
    font-size: 9px;
    font-weight: 650;
    cursor: pointer;
  }
  .policy form {
    display: grid;
    gap: 10px;
    margin-top: 9px;
    padding: 10px 0 2px;
    border-top: 1px solid var(--border);
  }
  .policy__fields {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .policy label > span {
    display: block;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 9px;
  }
  .policy input[type="number"] {
    width: 100%;
    min-height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }
  .policy footer {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .policy .inline-check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .policy .inline-check input {
    width: 13px;
    height: 13px;
  }
  .policy .inline-check span {
    margin: 0;
  }
  .policy button {
    display: inline-flex;
    height: 28px;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .policy button.delete {
    margin-left: auto;
    color: var(--status-down);
  }
  .policy button.delete + button {
    margin-left: 0;
  }
  .policy__message {
    margin: 0;
    color: var(--status-healthy);
    font-size: 9px;
  }
  .policy__message--error {
    color: var(--status-down);
  }
  section > p {
    margin-top: 3px;
    color: var(--text-faint);
    font-size: 10px;
  }
  section > p.section-message {
    color: var(--status-healthy);
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
    .policy__fields {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 420px) {
    .policy__fields {
      grid-template-columns: 1fr;
    }
    .policy footer {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }
    .policy button {
      width: 100%;
      justify-content: center;
      margin-left: 0;
    }
    .policy button.delete {
      margin-left: 0;
    }
  }
</style>
