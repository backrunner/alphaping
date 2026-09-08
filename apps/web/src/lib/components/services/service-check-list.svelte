<script lang="ts">
  import type { ServiceCheckSummary } from "@alphaping/db";
  import {
    ChevronLeft,
    ChevronRight,
    Radio,
    Save,
    Settings2,
    ShieldAlert,
    TimerReset,
    Trash2,
  } from "@lucide/svelte";

  import CheckConfigurationEditor from "$components/services/check-configuration-editor.svelte";
  import CheckHistoryPanel from "$components/services/check-history-panel.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let {
    checks,
    checkPagination,
    activeCheckCount,
    canManage,
    result,
    historyBase,
    pageBase,
  }: {
    checks: readonly ServiceCheckSummary[];
    checkPagination: { page: number; pages: number; total: number };
    activeCheckCount: number;
    canManage: boolean;
    historyBase: string;
    pageBase: string;
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
      <span>{activeCheckCount} active / {checkPagination.total} configured</span>
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
            <CheckConfigurationEditor {check} {result} />
          {/if}
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
  {#if checkPagination.pages > 1}
    <nav class="pagination" aria-label="Service check pages">
      {#if checkPagination.page > 1}
        <a href={`${pageBase}?checkPage=${checkPagination.page - 1}`}
          ><ChevronLeft size={13} />Previous</a
        >
      {:else}<span><ChevronLeft size={13} />Previous</span>{/if}
      <strong>Page {checkPagination.page} of {checkPagination.pages}</strong>
      {#if checkPagination.page < checkPagination.pages}
        <a href={`${pageBase}?checkPage=${checkPagination.page + 1}`}
          >Next<ChevronRight size={13} /></a
        >
      {:else}<span>Next<ChevronRight size={13} /></span>{/if}
    </nav>
  {/if}
</section>

<style>
  section {
    margin-top: var(--space-6);
  }

  header {
    margin-bottom: var(--space-3);
  }
  header > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: 14px;
    font-weight: 600;
  }
  header span {
    color: var(--text-faint);
    font-size: var(--text-xs);
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

  .table {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }
  article {
    display: grid;
    grid-template-columns: 24px minmax(180px, 1fr) 130px 80px 80px;
    align-items: center;
    gap: var(--space-2);
    min-height: 66px;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--border);
    transition: background-color 120ms ease;
  }
  article:hover {
    background: var(--surface-subtle);
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
    gap: var(--space-1);
    font-size: var(--text-base);
    font-weight: 620;
  }
  .main strong :global(svg) {
    flex: none;
    color: var(--status-down);
  }
  .main code {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .type,
  .muted {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .number {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .detail {
    display: flex;
    grid-column: 2 / -1;
    gap: var(--space-4);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .detail span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .detail .failure {
    color: var(--status-down);
  }
  .policy {
    grid-column: 2 / -1;
  }
  .policy summary {
    display: inline-flex;
    height: 26px;
    align-items: center;
    gap: var(--space-1);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 620;
    cursor: pointer;
  }
  .policy summary:hover {
    color: var(--accent-hover);
  }
  .policy form {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding: var(--space-3) 0 var(--space-1);
    border-top: 1px solid var(--border);
  }
  .policy__fields {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .policy label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .policy input[type="number"] {
    width: 100%;
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
  }
  .policy input[type="number"]:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .policy footer {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .policy .inline-check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .policy .inline-check input {
    width: 14px;
    height: 14px;
  }
  .policy .inline-check span {
    margin: 0;
  }
  .policy button {
    display: inline-flex;
    height: 28px;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }
  .policy button:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
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
    font-size: var(--text-xs);
  }
  .policy__message--error {
    color: var(--status-down);
  }
  section > p {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
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
      gap: var(--space-2) var(--space-3);
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
      gap: var(--space-2);
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
  @media (prefers-reduced-motion: reduce) {
    article,
    .policy button,
    .pagination a {
      transition: none;
    }
  }
</style>
