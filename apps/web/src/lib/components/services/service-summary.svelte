<script lang="ts">
  import { Clock3, Gauge, Radio } from "@lucide/svelte";
  import type { ServiceDetail } from "@alphaping/db";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { service }: { service: ServiceDetail["service"] } = $props();

  function formatAvailability(value: number | null): string {
    return value === null ? "No history" : `${(value / 10).toFixed(2)}%`;
  }

  function formatLatency(value: number | null): string {
    return value === null ? "No data" : `${value} ms`;
  }

  function formatTimestamp(value: number | null): string {
    return value === null ? "Not recorded" : new Date(value).toLocaleString();
  }
</script>

<section class="metric-strip" aria-label="Service summary">
  <div>
    <span><Radio size={13} />Checks</span><strong>{service.checkCount}</strong>
  </div>
  <div>
    <span><Gauge size={13} />Current latency</span><strong
      >{formatLatency(service.latencyMs)}</strong
    >
  </div>
  <div>
    <span><Clock3 size={13} />24 hour availability</span>
    <strong>{formatAvailability(service.availability24hPermille)}</strong>
    <small>thirty-minute buckets</small>
  </div>
  <div>
    <span>Last check</span><strong>{formatRelativeTime(service.lastCheckedAt)}</strong>
    <small title={formatTimestamp(service.lastCheckedAt)}
      >{formatTimestamp(service.lastCheckedAt)}</small
    >
  </div>
  <div>
    <span>Current state since</span><strong>{formatRelativeTime(service.lastTransitionAt)}</strong>
    <small title={formatTimestamp(service.lastTransitionAt)}
      >{formatTimestamp(service.lastTransitionAt)}</small
    >
  </div>
</section>

<section class="timeline" aria-labelledby="timeline-heading">
  <header>
    <div>
      <h2 id="timeline-heading">Availability</h2>
      <span>Last 24 hours</span>
    </div>
    <strong>{formatAvailability(service.availability24hPermille)}</strong>
  </header>
  <StatusCapsules buckets={service.timeline} label={`${service.name} availability over 24 hours`} />
  <div class="timeline-labels"><span>24 hours ago</span><span>Now</span></div>
</section>

<style>
  .metric-strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding: var(--space-5) 0;
    border-bottom: 1px solid var(--border);
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
    padding-right: 0;
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

  .metric-strip strong {
    margin-top: var(--space-2);
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric-strip small {
    margin-top: var(--space-1);
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline {
    padding-top: var(--space-5);
  }

  .timeline header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }

  .timeline header > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .timeline h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .timeline header span,
  .timeline-labels {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .timeline header strong {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .timeline-labels {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-2);
    font-family: var(--font-mono);
  }

  @media (max-width: 860px) {
    .metric-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: var(--space-5);
    }

    .metric-strip > div:nth-child(even) {
      border-right: 0;
    }

    .metric-strip > div:last-child {
      padding-left: 0;
    }
  }

  @media (max-width: 420px) {
    .metric-strip > div {
      padding: 0 var(--space-2);
    }
  }
</style>
