<script lang="ts">
  import type { MachineProbeTask } from "@alphaping/db";
  import { Activity, Clock3, Globe2, Network, RadioTower } from "@lucide/svelte";

  import ProbeVisuals from "$components/machines/probe-visuals.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { tasks }: { tasks: readonly MachineProbeTask[] } = $props();

  const healthy = $derived(tasks.filter((task) => task.latest?.state === "healthy").length);
  const failing = $derived(
    tasks.filter((task) => task.latest?.state === "degraded" || task.latest?.state === "down")
      .length,
  );
</script>

{#if tasks.length === 0}
  <EmptyState
    compact
    icon={Activity}
    title="No assigned probes"
    description="This Agent has no visible service checks assigned to it."
  />
{:else}
  <section class="summary" aria-label="Agent probe summary">
    <div><span>Assigned</span><strong>{tasks.length}</strong></div>
    <div><span>Healthy</span><strong>{healthy}</strong></div>
    <div><span>Problems</span><strong class:problem={failing > 0}>{failing}</strong></div>
  </section>

  <div class="task-list">
    {#each tasks as task (task.id)}
      <article class="task">
        <header>
          <div class="identity">
            <span class="kind" title={`${task.kind.toUpperCase()} probe`}>
              {#if task.kind === "http"}<Globe2 size={14} />{:else if task.kind === "tcp"}<Network
                  size={14}
                />{:else}<RadioTower size={14} />{/if}
            </span>
            <div>
              <h2>{task.name}</h2>
              <p><span>{task.serviceName}</span><code>{task.target}</code></p>
            </div>
          </div>
          <StatusLabel status={task.latest?.state ?? "unknown"} />
        </header>

        <div class="metrics">
          <div>
            <span>Latency</span><strong
              >{task.latest?.latencyMs ?? "--"}{task.latest?.latencyMs !== null &&
              task.latest?.latencyMs !== undefined
                ? " ms"
                : ""}</strong
            >
          </div>
          <div><span>Interval</span><strong>{task.intervalSeconds}s</strong></div>
          <div><span>Timeout</span><strong>{task.timeoutMs}ms</strong></div>
          <div>
            <span>Last result</span><strong
              >{formatRelativeTime(task.latest?.observedAt ?? null)}</strong
            >
          </div>
        </div>

        <ProbeVisuals {task} />

        <footer>
          <span><Clock3 size={11} />revision {task.assignmentRevision}</span>
          {#if task.latest?.failureCode}<code>{task.latest.failureCode}</code>{/if}
        </footer>
      </article>
    {/each}
  </div>
{/if}

<style>
  h2,
  p {
    margin: 0;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 120px));
    gap: var(--space-5);
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .summary span,
  .metrics span {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .summary strong {
    display: block;
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .summary strong.problem {
    color: var(--status-down);
  }

  .task {
    padding: var(--space-5) 0;
    border-bottom: 1px solid var(--border);
  }

  .task > header,
  .identity,
  .identity p,
  footer,
  footer span {
    display: flex;
    align-items: center;
  }

  .task > header {
    justify-content: space-between;
    gap: var(--space-4);
  }

  .identity {
    min-width: 0;
    gap: var(--space-2);
  }

  .kind {
    display: grid;
    width: 28px;
    height: 28px;
    flex: none;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--accent);
    background: var(--surface);
  }

  .identity > div {
    min-width: 0;
  }

  h2 {
    overflow: hidden;
    font-size: var(--text-base);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity p {
    min-width: 0;
    gap: var(--space-2);
    margin-top: 2px;
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .identity code {
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    margin: var(--space-4) 0 var(--space-3) 36px;
  }

  .metrics strong {
    display: block;
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  footer {
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-3) 0 0 36px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  footer span {
    gap: var(--space-1);
  }

  footer code {
    color: var(--status-down);
  }

  @media (max-width: 680px) {
    .summary {
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-3);
    }

    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metrics,
    footer {
      margin-left: 0;
    }

    .identity p span {
      display: none;
    }
  }
</style>
