<script lang="ts">
  import PublicSurface from "$components/status/public-surface.svelte";
  import PublicNavigation from "$components/status/public-navigation.svelte";
  import { ArrowLeft, Clock3, Gauge, History } from "@lucide/svelte";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head>
  <title
    >{data.service.name} status · {data.dashboard.appearance?.title || data.workspace.name}</title
  >
  <meta name="description" content={`Current public service status for ${data.service.name}`} />
</svelte:head>

<PublicSurface appearance={data.dashboard.appearance} workspace={data.workspace.slug}>
  <main>
    <PublicNavigation
      workspace={data.workspace}
      title={data.dashboard.appearance?.title}
      logoUrl={data.dashboard.appearance?.logoUrl}
    />
    <a class="back" href={`/status/${data.workspace.slug}`}><ArrowLeft size={15} />All status</a>
    <header class="resource-header">
      <div>
        <h1>{data.service.name}</h1>
        {#if data.service.description}<p>{data.service.description}</p>{/if}
      </div>
      <StatusLabel status={data.service.state} />
    </header>

    <section class="summary" aria-label="Service status summary">
      <div>
        <span><Gauge size={14} />Availability</span>
        <strong>
          {data.service.availability24hPermille === null
            ? "No history"
            : `${(data.service.availability24hPermille / 10).toFixed(2)}%`}
        </strong>
        <small>last 24 hours</small>
      </div>
      <div>
        <span><Clock3 size={14} />Last checked</span>
        <strong>{formatRelativeTime(data.service.lastCheckedAt)}</strong>
      </div>
      <div>
        <span><History size={14} />Last transition</span>
        <strong>{formatRelativeTime(data.service.lastTransitionAt)}</strong>
      </div>
    </section>

    <section class="timeline" aria-labelledby="timeline-title">
      <header>
        <div>
          <h2 id="timeline-title">Availability history</h2>
          <p>Thirty-minute status windows</p>
        </div>
        <span>Last 24 hours</span>
      </header>
      <div class="track">
        <StatusCapsules
          buckets={data.service.timeline}
          label={`${data.service.name} availability over 24 hours`}
        />
      </div>
      <div class="track-label"><span>24 hours ago</span><span>Now</span></div>
    </section>

    <footer>
      <span title={data.updatedAt === null ? undefined : new Date(data.updatedAt).toLocaleString()}
        >Updated {formatRelativeTime(data.updatedAt)}</span
      ><span>Powered by AlphaPing</span>
    </footer>
  </main>
</PublicSurface>

<style>
  main {
    max-width: var(--content-narrow);
    margin: 0 auto;
    padding: 0 32px 40px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .back:hover {
    color: var(--accent);
  }

  .resource-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-top: 24px;
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: linear-gradient(120deg, var(--surface), var(--accent-soft));
    box-shadow: var(--shadow-panel);
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    margin-top: var(--space-1);
    font-size: 34px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .resource-header p {
    max-width: 64ch;
    margin-top: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-base);
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-top: var(--space-6);
  }

  .summary > div {
    min-width: 0;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .summary span,
  .summary strong,
  .summary small {
    display: flex;
  }

  .summary span {
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .summary strong {
    margin-top: 16px;
    font-family: var(--font-mono);
    font-size: 26px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .summary small {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .timeline {
    margin-top: var(--space-6);
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .timeline > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .timeline h2 {
    font-size: 20px;
    font-weight: 600;
  }

  .timeline p,
  .timeline > header > span {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .track {
    --capsule-count: 48;

    margin-top: 24px;
  }

  .track-label {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-2);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-8);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  @media (max-width: 768px) {
    main {
      padding: 0 24px 32px;
    }
  }

  @media (max-width: 620px) {
    .summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .summary > div {
      padding: 18px;
    }
    .summary > div:first-child {
      grid-column: 1 / -1;
    }
    .summary strong {
      font-size: 22px;
    }
    .timeline > header {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    }

    .resource-header {
      padding: 24px;
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (max-width: 480px) {
    main {
      padding: 0 18px 28px;
    }
  }
</style>
