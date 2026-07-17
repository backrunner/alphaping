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
    border-block: 1px solid var(--border);
  }

  .table-head,
  .service-row {
    display: grid;
    grid-template-columns: minmax(140px, 1.2fr) 110px 80px 70px 90px minmax(280px, 2fr);
    align-items: center;
    gap: 12px;
  }

  .table-head {
    height: 32px;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 620;
  }

  .service-row {
    min-height: 54px;
    border-top: 1px solid var(--border);
    color: var(--text);
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
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity small,
  .muted {
    color: var(--text-faint);
    font-size: 10px;
  }

  .number {
    font-family: var(--font-mono);
    font-size: 10px;
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
      gap: 8px;
      padding: 10px 0;
    }

    .service-row > :nth-child(4),
    .service-row > :nth-child(5) {
      display: none;
    }

    .timeline {
      grid-column: 1 / -1;
    }
  }
</style>
