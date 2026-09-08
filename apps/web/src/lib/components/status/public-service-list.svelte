<script lang="ts">
  import { page } from "$app/state";
  import { ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import type { PublicStatusView } from "$lib/public-status-view";
  import { formatRelativeTime } from "$lib/utils/format";

  let {
    services,
    pagination,
    workspaceSlug,
  }: {
    services: PublicStatusView["services"];
    pagination: PublicStatusView["servicePagination"];
    workspaceSlug: string;
  } = $props();

  function paginationHref(value: number): string {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    if (value <= 1) params.delete("servicePage");
    else params.set("servicePage", String(value));
    const query = params.toString();
    return `${page.url.pathname}${query ? `?${query}` : ""}`;
  }
</script>

<section aria-labelledby="services-title">
  <header>
    <div>
      <h2 id="services-title">Services</h2>
      <span>{pagination.total} published</span>
    </div>
    <small>{pagination.from}-{pagination.to} · Last 24 hours</small>
  </header>
  {#if services.length > 0}
    <div class="service-list">
      {#each services as service (service.slug)}
        <article class="service">
          <div class="service-line">
            <div class="identity">
              <a href={`/status/${workspaceSlug}/services/${service.slug}`}
                ><strong>{service.name}</strong></a
              >
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
          <div class="history">
            <div class="track">
              <StatusCapsules
                buckets={service.timeline}
                label={`${service.name} availability over 24 hours`}
              />
            </div>
            <div class="track-label">
              <span>24 hours ago</span><span
                >{service.lastCheckedAt === null
                  ? "Not checked yet"
                  : `Checked ${formatRelativeTime(service.lastCheckedAt)}`}</span
              >
            </div>
          </div>
        </article>
      {/each}
    </div>
    {#if pagination.pageCount > 1}
      <nav class="pagination" aria-label="Published service pages">
        {#if pagination.page > 1}
          <a href={paginationHref(pagination.page - 1)}><ChevronLeft size={13} />Previous</a>
        {:else}<span><ChevronLeft size={13} />Previous</span>{/if}
        <strong>Page {pagination.page} of {pagination.pageCount}</strong>
        {#if pagination.page < pagination.pageCount}
          <a href={paginationHref(pagination.page + 1)}>Next<ChevronRight size={13} /></a>
        {:else}<span>Next<ChevronRight size={13} /></span>{/if}
      </nav>
    {/if}
  {:else}<p class="empty">No services are published on this status page.</p>{/if}
</section>

<style>
  section {
    margin-top: var(--space-8);
  }

  section > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  section > header > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
  }

  header span,
  header small {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .service-list {
    padding: 0 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }
  .service:last-child {
    border-bottom: 0;
  }
  .service {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
    align-items: center;
    gap: 40px;
    min-width: 0;
    padding: 24px 0;
    border-bottom: 1px solid var(--border);
  }
  :global([data-density="compact"]) .service {
    padding: 16px 0;
  }
  .service-line {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .history {
    min-width: 0;
  }
  @media (max-width: 620px) {
    .service-list {
      padding: 0 20px;
    }
    .service {
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
    }
  }

  .identity {
    min-width: 0;
  }

  .identity strong,
  .identity span {
    display: block;
  }

  .identity strong {
    font-size: 16px;
    font-weight: 580;
  }

  .identity a {
    color: var(--text);
    text-decoration: none;
  }

  .identity a:hover {
    color: var(--accent);
  }

  .identity span {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .service-metrics {
    display: flex;
    justify-content: flex-start;
    flex: none;
    align-items: center;
    gap: var(--space-3);
  }

  .service-metrics > span {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .track {
    --capsule-count: 48;
  }

  .track-label {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-2);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .empty {
    padding: var(--space-6) 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    min-height: 32px;
    margin-top: var(--space-3);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .pagination a,
  .pagination span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .pagination a {
    color: var(--accent);
    text-decoration: none;
  }

  .pagination a:last-child,
  .pagination span:last-child {
    justify-self: end;
  }

  .pagination strong {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  @media (max-width: 560px) {
    section > header {
      flex-wrap: wrap;
    }

    .service-metrics {
      align-items: center;
      gap: var(--space-1);
    }
  }
</style>
