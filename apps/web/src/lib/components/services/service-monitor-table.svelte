<script lang="ts">
  import type { ServiceCollection } from "@alphaping/db";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let {
    services,
    workspaceSlug,
  }: { services: ServiceCollection["services"]; workspaceSlug: string } = $props();
</script>

<div class="service-table" role="table" aria-label="Service monitors">
  <div class="table-head" role="row">
    <span role="columnheader">Service</span><span role="columnheader">State</span>
    <span role="columnheader">Latency</span><span role="columnheader">24h</span>
    <span role="columnheader">Last check</span><span role="columnheader">Timeline</span>
  </div>
  {#each services as service (service.id)}
    <div class="service-row" role="row">
      <span class="identity" role="cell">
        <a href={`/${workspaceSlug}/services/${service.id}`}>
          <strong>{service.name}</strong><small
            >{service.checkCount} {service.checkCount === 1 ? "check" : "checks"}</small
          >
        </a>
      </span>
      <span role="cell"><StatusLabel status={service.state} /></span>
      <span
        class="number"
        role="cell"
        title={service.latencyMs === null ? "Not measured" : undefined}
        >{service.latencyMs === null ? "No data" : `${service.latencyMs} ms`}</span
      >
      <span class="number" role="cell"
        >{service.availability24hPermille === null
          ? "No data"
          : `${(service.availability24hPermille / 10).toFixed(1)}%`}</span
      >
      <span class="muted" role="cell">{formatRelativeTime(service.lastCheckedAt)}</span>
      <span class="timeline" role="cell">
        <StatusCapsules
          buckets={service.timeline}
          label={`${service.name} status over 24 hours`}
          compact
        />
      </span>
    </div>
  {/each}
</div>

<style>
  .service-table {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .table-head,
  .service-row {
    display: grid;
    grid-template-columns: minmax(140px, 1.2fr) 110px 80px 70px 96px minmax(280px, 2fr);
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3);
  }

  .table-head {
    height: 34px;
    color: var(--text-faint);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  .service-row {
    min-height: 56px;
    border-top: 1px solid var(--border);
    color: var(--text);
    transition: background-color 120ms ease;
  }

  .service-row:hover {
    background: var(--surface-subtle);
  }

  .identity,
  .identity strong,
  .identity small {
    display: block;
    min-width: 0;
  }

  .identity a {
    color: var(--text);
    text-decoration: none;
  }

  .identity a:hover strong {
    color: var(--accent);
  }

  .identity strong {
    overflow: hidden;
    font-size: var(--text-base);
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity small,
  .muted {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .number {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .timeline {
    min-width: 0;
    --capsule-count: 48;
  }

  @media (max-width: 900px) {
    .table-head {
      display: none;
    }

    .service-row {
      grid-template-columns: 1fr auto auto;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
    }

    .service-row:first-child {
      border-top: 0;
    }

    .service-row > :nth-child(4),
    .service-row > :nth-child(5) {
      display: none;
    }

    .timeline {
      grid-column: 1 / -1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .service-row {
      transition: none;
    }
  }
</style>
