<script lang="ts">
  import {
    Activity,
    ArrowDown,
    ArrowUp,
    ChartLine,
    CircleCheck,
    Clock3,
    Cpu,
    HardDrive,
    MemoryStick,
    Radio,
    TriangleAlert,
  } from "@lucide/svelte";
  import type { DashboardMachine, MachineDetail } from "@alphaping/db";

  import HistoryPanel from "$components/machines/history-panel.svelte";
  import type { MachineMetric } from "$components/machines/history-panel.svelte";
  import { formatBytes, formatPercent, formatRate } from "$lib/utils/format";

  let { detail, latest }: { detail: MachineDetail; latest: DashboardMachine } = $props();
  const hasTelemetry = $derived(latest.observedAt !== null);
  let selectedMetric = $state<MachineMetric | null>(null);

  function formatTimestamp(value: number | null) {
    if (value === null) return "Never";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(value);
  }

  function formatLoad(value: number | null) {
    return value === null ? "Unknown" : (value / 1_000).toFixed(2);
  }

  function formatUptime(value: number | null) {
    if (value === null) return "Unknown";
    const days = Math.floor(value / 86_400);
    const hours = Math.floor((value % 86_400) / 3_600);
    const minutes = Math.floor((value % 3_600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function formatSource(value: string) {
    return value.replaceAll("_", " ").replaceAll("-", " ");
  }
</script>

<div class="metric-strip" aria-label="Current machine metrics">
  <div>
    <span
      ><Cpu size={13} />CPU<button
        type="button"
        title="View CPU history"
        aria-label="View CPU history"
        onclick={() => (selectedMetric = "cpu")}><ChartLine size={13} /></button
      ></span
    ><strong>{hasTelemetry ? formatPercent(latest.cpuPermille) : "—"}</strong>
  </div>
  <div>
    <span><Activity size={13} />Load 1m</span><strong>{formatLoad(latest.load1mMilli)}</strong>
  </div>
  <div>
    <span
      ><MemoryStick size={13} />Memory<button
        type="button"
        title="View memory history"
        aria-label="View memory history"
        onclick={() => (selectedMetric = "memory")}><ChartLine size={13} /></button
      ></span
    >
    <strong>{hasTelemetry ? formatBytes(latest.memoryUsedBytes) : "—"}</strong>
    <small>of {hasTelemetry ? formatBytes(latest.memoryTotalBytes) : "—"}</small>
  </div>
  <div>
    <span
      ><HardDrive size={13} />Storage<button
        type="button"
        title="View storage history"
        aria-label="View storage history"
        onclick={() => (selectedMetric = "storage")}><ChartLine size={13} /></button
      ></span
    >
    <strong>{hasTelemetry ? formatBytes(latest.storageUsedBytes) : "—"}</strong>
    <small>of {hasTelemetry ? formatBytes(latest.storageTotalBytes) : "—"}</small>
  </div>
  <div>
    <span><Clock3 size={13} />Uptime</span><strong>{formatUptime(latest.uptimeSeconds)}</strong>
  </div>
  <div>
    <span
      ><ArrowDown size={13} />Download<button
        type="button"
        title="View network history"
        aria-label="View network history"
        onclick={() => (selectedMetric = "network")}><ChartLine size={13} /></button
      ></span
    >
    <strong>{hasTelemetry ? formatRate(latest.networkRxBps) : "—"}</strong>
    <small>{hasTelemetry ? formatBytes(latest.networkRxTotal) : "—"} total</small>
  </div>
  <div>
    <span><ArrowUp size={13} />Upload</span>
    <strong>{hasTelemetry ? formatRate(latest.networkTxBps) : "—"}</strong>
    <small>{hasTelemetry ? formatBytes(latest.networkTxTotal) : "—"} total</small>
  </div>
</div>

{#if !detail.agent}
  <div class="notice">
    <Radio size={16} />
    <div>
      <strong>Waiting for enrollment</strong><span>Install the Agent to begin reporting.</span>
    </div>
  </div>
{/if}

<HistoryPanel
  endpoint={`/${detail.workspace.slug}/machines/${detail.machine.id}/metrics`}
  bind:selectedMetric
/>

<section class="details-section">
  <header>
    <h2>System and Agent</h2>
  </header>
  <dl class="detail-grid">
    <div>
      <dt>Expected host</dt>
      <dd>{detail.machine.expectedHost ?? "Not set"}</dd>
    </div>
    <div>
      <dt>Hostname</dt>
      <dd>{detail.agent?.hostname ?? "Unknown"}</dd>
    </div>
    <div>
      <dt>Operating system</dt>
      <dd>
        {detail.agent
          ? [detail.agent.osName ?? detail.agent.platform, detail.agent.osVersion]
              .filter(Boolean)
              .join(" ")
          : "Unknown"}
      </dd>
    </div>
    <div>
      <dt>Kernel</dt>
      <dd>{detail.agent?.kernelVersion ?? "Unknown"}</dd>
    </div>
    <div>
      <dt>Architecture</dt>
      <dd>{detail.agent?.arch ?? "Unknown"}</dd>
    </div>
    <div>
      <dt>Agent version</dt>
      <dd>{detail.agent?.version ?? "Not enrolled"}</dd>
    </div>
    <div>
      <dt>Agent enrolled</dt>
      <dd>{formatTimestamp(detail.agent?.enrolledAt ?? null)}</dd>
    </div>
    <div>
      <dt>Agent contact</dt>
      <dd>{formatTimestamp(detail.agent?.lastSeenAt ?? null)}</dd>
    </div>
    <div>
      <dt>Telemetry received</dt>
      <dd>{formatTimestamp(detail.latestReceivedAt)}</dd>
    </div>
    <div>
      <dt>Sampling</dt>
      <dd>{detail.machine.samplingIntervalSeconds} seconds</dd>
    </div>
    <div>
      <dt>Durable report</dt>
      <dd>{detail.machine.reportIntervalSeconds} seconds</dd>
    </div>
    <div>
      <dt>Offline threshold</dt>
      <dd>{detail.machine.offlineAfterSeconds} seconds</dd>
    </div>
    <div>
      <dt>Config revision</dt>
      <dd>{detail.agent?.appliedConfigRevision ?? 0} / {detail.machine.desiredConfigRevision}</dd>
    </div>
    <div class="last-error">
      <dt>Last error</dt>
      {#if detail.lastError}
        <dd class="error-detail">
          <span><TriangleAlert size={12} />{detail.lastError.code}</span>
          <small>
            {formatSource(detail.lastError.sourceLabel)} · {formatTimestamp(
              detail.lastError.occurredAt,
            )}
          </small>
        </dd>
      {:else}
        <dd class="clear-detail"><CircleCheck size={12} />No recent reported errors</dd>
      {/if}
    </div>
  </dl>
</section>

<style>
  .metric-strip {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    padding-bottom: var(--space-5);
  }

  .metric-strip > div {
    min-width: 0;
    padding: 0 var(--space-4);
    border-right: 1px solid var(--border);
  }

  .metric-strip > div:first-child {
    padding-left: 0;
  }

  .metric-strip > div:last-child {
    border-right: 0;
  }

  .metric-strip span,
  .metric-strip strong,
  .metric-strip small {
    display: flex;
  }

  .metric-strip span {
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .metric-strip span button {
    display: inline-grid;
    width: 24px;
    height: 24px;
    margin-left: auto;
    place-items: center;
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-faint);
    background: transparent;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .metric-strip span button:hover {
    color: var(--accent);
    background: var(--surface-subtle);
  }

  .metric-strip strong {
    margin-top: var(--space-1);
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric-strip small {
    margin-top: 2px;
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    background: var(--surface);
  }

  .notice strong,
  .notice span {
    display: block;
  }

  .notice strong {
    color: var(--text);
    font-size: var(--text-sm);
  }

  .notice span {
    margin-top: 2px;
    font-size: var(--text-xs);
  }

  .details-section {
    padding-top: var(--space-5);
  }

  .details-section header {
    margin-bottom: var(--space-3);
  }

  h2 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
    border-block: 1px solid var(--border);
  }

  .detail-grid > div {
    min-width: 0;
    padding: var(--space-3);
  }

  .detail-grid dt {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .detail-grid dd {
    margin: var(--space-1) 0 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-grid .last-error {
    grid-column: span 2;
  }

  .detail-grid .error-detail,
  .detail-grid .clear-detail,
  .detail-grid .error-detail span {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .detail-grid .error-detail {
    align-items: flex-start;
    flex-direction: column;
    color: var(--status-down);
  }

  .detail-grid .error-detail small {
    overflow: hidden;
    max-width: 100%;
    color: var(--text-faint);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-grid .clear-detail {
    color: var(--status-healthy);
  }

  @media (max-width: 820px) {
    .metric-strip,
    .detail-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metric-strip {
      row-gap: var(--space-5);
    }

    .metric-strip > div:nth-child(odd) {
      padding-left: 0;
    }

    .metric-strip > div:nth-child(even) {
      border-right: 0;
    }
  }

  @media (max-width: 520px) {
    .metric-strip > div {
      padding: 0 var(--space-3);
    }

    .metric-strip > div:nth-child(odd) {
      padding-left: 0;
    }

    .detail-grid {
      grid-template-columns: 1fr;
    }

    .detail-grid .last-error {
      grid-column: auto;
    }
  }
</style>
