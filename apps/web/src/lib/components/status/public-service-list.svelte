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

  .identity a {
    color: var(--text);
    text-decoration: none;
  }

  .identity a:hover {
    color: var(--accent);
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

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    min-height: 32px;
    margin-top: 10px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .pagination a,
  .pagination span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
    font-weight: 500;
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
