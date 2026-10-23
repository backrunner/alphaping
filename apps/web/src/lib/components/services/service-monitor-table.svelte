<script lang="ts">
  import type { ServiceCollection } from "@alphaping/db";

  import StatusCapsules from "#lib/components/status/status-capsules.svelte";
  import StatusLabel from "#lib/components/status/status-label.svelte";
  import { formatRelativeTime } from "#lib/utils/format.ts";

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
        data-label="Latency"
        title={service.latencyMs === null ? "Not measured" : undefined}
        >{service.latencyMs === null ? "No data" : `${service.latencyMs} ms`}</span
      >
      <span class="number" role="cell" data-label="24h uptime"
        >{service.availability24hPermille === null
          ? "No data"
          : `${(service.availability24hPermille / 10).toFixed(1)}%`}</span
      >
      <span class="muted" role="cell" data-label="Last check"
        >{formatRelativeTime(service.lastCheckedAt)}</span
      >
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
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .table-head,
  .service-row {
    display: grid;
    grid-template-columns: minmax(120px, 1.2fr) 100px 80px 70px 90px minmax(200px, 2fr);
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3);
  }

  .table-head {
    height: 34px;
    color: var(--text-faint);
    background: var(--surface-subtle);
    border-radius: calc(var(--radius-card) - 1px) calc(var(--radius-card) - 1px) 0 0;
    font-size: var(--text-xs);
    font-weight: 620;
  }

  .service-row {
    min-height: 56px;
    border-top: 1px solid var(--border);
    color: var(--text);
    transition: background-color 120ms ease;
  }

  .service-row:last-child {
    border-bottom-left-radius: calc(var(--radius-card) - 1px);
    border-bottom-right-radius: calc(var(--radius-card) - 1px);
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

  .service-row > span {
    min-width: 0;
  }
  @container (max-width: 1000px) {
    .table-head {
      display: none;
    }
    .service-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-3) var(--space-2);
      padding: var(--space-4);
    }
    .service-row:nth-child(2) {
      border-top: 0;
      border-top-left-radius: calc(var(--radius-card) - 1px);
      border-top-right-radius: calc(var(--radius-card) - 1px);
    }
    .identity {
      grid-column: 1 / 3;
    }
    .identity a {
      display: grid;
      min-height: 44px;
      align-content: center;
    }
    .identity strong {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .service-row > :nth-child(2) {
      justify-self: end;
    }
    .service-row [data-label]::before {
      display: block;
      content: attr(data-label);
      margin-bottom: var(--space-1);
      color: var(--text-faint);
      font-family: var(--font-sans);
      font-size: var(--text-xs);
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
