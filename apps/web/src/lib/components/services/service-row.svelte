<script lang="ts">
  import type { DashboardService } from "@alphaping/db";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { service, workspaceSlug }: { service: DashboardService; workspaceSlug: string } = $props();

  // One-time background tint when the aggregated state flips (doc §13.1:
  // a short transition only, never a continuous pulse).
  let tint = $state<string | null>(null);
  let previousState: string | undefined;
  $effect(() => {
    const state = service.state;
    if (previousState === undefined) {
      previousState = state;
      return;
    }
    if (state === previousState) return;
    previousState = state;
    tint = state;
    const timer = setTimeout(() => (tint = null), 900);
    return () => clearTimeout(timer);
  });
</script>

<article class="service" data-tint={tint}>
  <div class="service__identity">
    <a href={`/${workspaceSlug}/services/${service.id}`}>{service.name}</a>
    <span
      >{service.lastCheckedAt === null
        ? "Not checked yet"
        : `Checked ${formatRelativeTime(service.lastCheckedAt)}`}</span
    >
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
    gap: var(--space-4);
    padding: var(--space-3) var(--space-2);
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-button);
    transition: background-color 150ms ease;
  }

  .service:hover {
    background: var(--surface-subtle);
  }

  .service:first-child {
    border-top: 1px solid var(--border);
  }

  .service[data-tint="healthy"] {
    animation: row-tint 900ms ease-out;
    --tint: var(--status-healthy-bg);
  }

  .service[data-tint="degraded"] {
    animation: row-tint 900ms ease-out;
    --tint: var(--status-degraded-bg);
  }

  .service[data-tint="down"] {
    animation: row-tint 900ms ease-out;
    --tint: var(--status-down-bg);
  }

  .service[data-tint="maintenance"] {
    animation: row-tint 900ms ease-out;
    --tint: var(--status-maintenance-bg);
  }

  .service[data-tint="unknown"] {
    animation: row-tint 900ms ease-out;
    --tint: var(--status-offline-bg);
  }

  @keyframes row-tint {
    from {
      background: var(--tint);
    }

    to {
      background: transparent;
    }
  }

  .service__identity {
    min-width: 0;
  }

  .service__identity a {
    display: block;
    overflow: hidden;
    color: var(--text);
    font-size: var(--text-base);
    font-weight: 650;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .service__identity a:hover {
    color: var(--accent);
  }

  .service__identity span {
    color: var(--text-faint);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .service__timeline {
    min-width: 0;
    --capsule-count: 30;
  }

  @media (max-width: 760px) {
    .service {
      grid-template-columns: 1fr auto;
      gap: var(--space-2);
    }

    .service__timeline {
      grid-column: 1 / -1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .service {
      animation: none;
    }
  }
</style>
