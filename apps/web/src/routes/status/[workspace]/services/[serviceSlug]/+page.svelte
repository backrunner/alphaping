<script lang="ts">
  import { ArrowLeft, Clock3, Gauge, History } from "@lucide/svelte";

  import StatusCapsules from "$components/status/status-capsules.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.service.name} status · {data.workspace.name}</title>
  <meta name="description" content={`Current public service status for ${data.service.name}`} />
</svelte:head>

<main>
  <a class="back" href={`/status/${data.workspace.slug}`}><ArrowLeft size={15} />All status</a>
  <header class="resource-header">
    <div>
      <span class="workspace">{data.workspace.name}</span>
      <h1>{data.service.name}</h1>
      {#if data.service.description}<p>{data.service.description}</p>{/if}
    </div>
    <StatusLabel status={data.service.state} />
  </header>

  <section class="summary" aria-label="Service status summary">
    <div>
      <span><Gauge size={15} />Availability</span>
      <strong>
        {data.service.availability24hPermille === null
          ? "No history"
          : `${(data.service.availability24hPermille / 10).toFixed(2)}%`}
      </strong>
      <small>last 24 hours</small>
    </div>
    <div>
      <span><Clock3 size={15} />Last checked</span>
      <strong>{formatRelativeTime(data.service.lastCheckedAt)}</strong>
      <small>latest published result</small>
    </div>
    <div>
      <span><History size={15} />Last transition</span>
      <strong>{formatRelativeTime(data.service.lastTransitionAt)}</strong>
      <small>state changed</small>
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
    <span>Updated {formatRelativeTime(data.updatedAt)}</span><span>Powered by AlphaPing</span>
  </footer>
</main>

<style>
  main {
    width: min(100% - 28px, 920px);
    margin: 0 auto;
    padding: 30px 0 36px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
    text-decoration: none;
  }

  .back:hover {
    color: var(--accent);
  }

  .resource-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-top: 22px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--border);
  }

  .workspace {
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 650;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    margin-top: 5px;
    font-size: 26px;
  }

  .resource-header p {
    max-width: 64ch;
    margin-top: 6px;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 24px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .summary > div {
    min-width: 0;
    padding: 16px;
    border-right: 1px solid var(--border);
  }

  .summary > div:last-child {
    border-right: 0;
  }

  .summary span,
  .summary strong,
  .summary small {
    display: flex;
  }

  .summary span {
    align-items: center;
    gap: 7px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .summary strong {
    margin-top: 9px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary small {
    margin-top: 3px;
    color: var(--text-faint);
    font-size: 11px;
  }

  .timeline {
    margin-top: 30px;
  }

  .timeline > header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }

  .timeline h2 {
    font-size: 16px;
  }

  .timeline p,
  .timeline > header > span {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .track {
    --capsule-count: 48;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .track-label {
    display: flex;
    justify-content: space-between;
    margin-top: 7px;
    color: var(--text-faint);
    font-size: 11px;
  }

  footer {
    display: flex;
    justify-content: space-between;
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11px;
  }

  @media (max-width: 620px) {
    .summary {
      grid-template-columns: 1fr;
    }

    .summary > div {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .summary > div:last-child {
      border-bottom: 0;
    }

    .resource-header {
      flex-direction: column;
    }

    footer {
      flex-direction: column;
      gap: 4px;
    }
  }
</style>
