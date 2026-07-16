<script lang="ts">
  import type { PublicStatusPage } from "@alphaping/db";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { services }: { services: PublicStatusPage["services"] } = $props();
</script>

<section aria-labelledby="services-title">
  <header>
    <div>
      <h2 id="services-title">Services</h2>
      <span>{services.length} published</span>
    </div>
    <small>Last 24 hours</small>
  </header>
  {#if services.length > 0}
    <div class="service-list">
      {#each services as service (service.slug)}
        <article class="service">
          <div class="service-line">
            <div class="identity">
              <strong>{service.name}</strong>
              {#if service.description}<span>{service.description}</span>{/if}
            </div>
            <div class="service-metrics">
              <span
                >{service.availability24hPermille === null
                  ? "No history"
                  : `${(service.availability24hPermille / 10).toFixed(2)}% uptime`}</span
              >
              <StatusLabel status={service.state} />
            </div>
          </div>
          <div class="track">
            <StatusCapsules
              buckets={service.timeline}
              label={`${service.name} availability over 24 hours`}
            />
          </div>
          <div class="track-label">
            <span>24 hours ago</span><span>Checked {formatRelativeTime(service.lastCheckedAt)}</span
            >
          </div>
        </article>
      {/each}
    </div>
  {:else}<p class="empty">No services are published on this status page.</p>{/if}
</section>

<style>
  section > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  section > header > div {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
  }

  header span,
  header small {
    color: var(--text-faint);
    font-size: 10px;
  }

  .service-list {
    border-block: 1px solid var(--border);
  }

  .service {
    padding: 14px 0;
    border-top: 1px solid var(--border);
  }

  .service:first-child {
    border-top: 0;
  }

  .service-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 10px;
  }

  .identity strong,
  .identity span {
    display: block;
  }

  .identity strong {
    font-size: 13px;
  }

  .identity span {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .service-metrics {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .service-metrics > span {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .track {
    --capsule-count: 48;
  }

  .track-label {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    color: var(--text-faint);
    font-size: 9px;
  }

  .empty {
    padding: 22px 0;
    color: var(--text-muted);
    font-size: 11px;
  }

  @media (max-width: 560px) {
    .service-line {
      align-items: flex-start;
    }

    .service-metrics {
      align-items: flex-end;
      flex-direction: column-reverse;
      gap: 5px;
    }
  }
</style>
