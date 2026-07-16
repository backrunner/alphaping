<script lang="ts">
  import { ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Radio } from "lucide-svelte";
  import type { DashboardMachine, MachineDetail } from "@alphaping/db";

  import HistoryPanel from "$components/machines/history-panel.svelte";
  import { formatBytes, formatPercent, formatRate } from "$lib/utils/format";

  let { detail, latest }: { detail: MachineDetail; latest: DashboardMachine } = $props();

  function formatTimestamp(value: number | null) {
    if (value === null) return "Never";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(value);
  }
</script>

<div class="metric-strip" aria-label="Current machine metrics">
  <div>
    <span><Cpu size={13} />CPU</span><strong>{formatPercent(latest.cpuPermille)}</strong>
  </div>
  <div>
    <span><MemoryStick size={13} />Memory</span>
    <strong>{formatBytes(latest.memoryUsedBytes)}</strong>
    <small>of {formatBytes(latest.memoryTotalBytes)}</small>
  </div>
  <div>
    <span><HardDrive size={13} />Storage</span>
    <strong>{formatBytes(latest.storageUsedBytes)}</strong>
    <small>of {formatBytes(latest.storageTotalBytes)}</small>
  </div>
  <div>
    <span><ArrowDown size={13} />Download</span>
    <strong>{formatRate(latest.networkRxBps)}</strong>
    <small>{formatBytes(latest.networkRxTotal)} total</small>
  </div>
  <div>
    <span><ArrowUp size={13} />Upload</span>
    <strong>{formatRate(latest.networkTxBps)}</strong>
    <small>{formatBytes(latest.networkTxTotal)} total</small>
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

<HistoryPanel endpoint={`/${detail.workspace.slug}/machines/${detail.machine.id}/metrics`} />

<section class="details-section">
  <header>
    <h2>Machine details</h2>
    <span>Current configuration and identity</span>
  </header>
  <dl class="detail-grid">
    <div>
      <dt>Expected host</dt>
      <dd>{detail.machine.expectedHost ?? "Not set"}</dd>
    </div>
    <div>
      <dt>Agent version</dt>
      <dd>{detail.agent?.version ?? "Not enrolled"}</dd>
    </div>
    <div>
      <dt>Platform</dt>
      <dd>{detail.agent ? `${detail.agent.platform} / ${detail.agent.arch}` : "Unknown"}</dd>
    </div>
    <div>
      <dt>Last received</dt>
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
  </dl>
</section>

<style>
  .metric-strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding-bottom: 18px;
  }

  .metric-strip > div {
    min-width: 0;
    padding: 0 14px;
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
    gap: 5px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .metric-strip strong {
    margin-top: 6px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric-strip small {
    margin-top: 2px;
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 16px;
    padding: 10px 11px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    background: var(--surface);
  }

  .notice strong,
  .notice span {
    display: block;
  }

  .notice strong {
    color: var(--text);
    font-size: 11px;
  }

  .notice span {
    margin-top: 1px;
    font-size: 10px;
  }

  .details-section {
    padding-top: 20px;
  }

  .details-section header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 11px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
  }

  .details-section header span {
    color: var(--text-muted);
    font-size: 10px;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
    border-block: 1px solid var(--border);
  }

  .detail-grid > div {
    min-width: 0;
    padding: 11px 12px;
  }

  .detail-grid dt {
    color: var(--text-faint);
    font-size: 9px;
    text-transform: uppercase;
  }

  .detail-grid dd {
    margin: 4px 0 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 820px) {
    .metric-strip,
    .detail-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metric-strip {
      row-gap: 18px;
    }

    .metric-strip > div:nth-child(even) {
      border-right: 0;
    }
  }

  @media (max-width: 520px) {
    .metric-strip > div {
      padding: 0 10px;
    }

    .detail-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
