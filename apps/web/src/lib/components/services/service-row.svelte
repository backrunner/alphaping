<script lang="ts">
  import type { DashboardService } from "@alphaping/db";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { service, workspaceSlug }: { service: DashboardService; workspaceSlug: string } = $props();
</script>

<article class="service">
  <div class="service__identity">
    <a href={`/${workspaceSlug}/services/${service.id}`}>{service.name}</a>
    <span>Checked {formatRelativeTime(service.lastCheckedAt)}</span>
  </div>
  <StatusLabel status={service.state} />
  <div class="service__timeline">
    <StatusCapsules
      buckets={service.timeline}
      label={`${service.name} status over the last 150 minutes`}
      compact
    />
  </div>
</article>

<style>
  .service {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) auto minmax(280px, 2fr);
    align-items: center;
    gap: 16px;
    padding: 11px 0;
    border-bottom: 1px solid var(--border);
  }

  .service:first-child {
    border-top: 1px solid var(--border);
  }

  .service__identity {
    min-width: 0;
  }

  .service__identity a {
    display: block;
    overflow: hidden;
    color: var(--text);
    font-size: 13px;
    font-weight: 650;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .service__identity span {
    color: var(--text-faint);
    font-size: 10px;
  }

  .service__timeline {
    min-width: 0;
    --capsule-count: 30;
  }

  @media (max-width: 760px) {
    .service {
      grid-template-columns: 1fr auto;
      gap: 8px;
    }

    .service__timeline {
      grid-column: 1 / -1;
    }
  }
</style>
