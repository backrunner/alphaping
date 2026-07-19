<script lang="ts">
  import type { MachineProbeTask } from "@alphaping/db";
  import { Activity, Clock3, Globe2, Network, RadioTower } from "lucide-svelte";

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
    gap: 18px;
    padding: 0 0 16px;
    border-bottom: 1px solid var(--border);
  }

  .summary span,
  .metrics span {
    display: block;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
  }

  .summary strong {
    display: block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: 17px;
  }

  .summary strong.problem {
    color: var(--status-down);
  }

  .task {
    padding: 18px 0;
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
    gap: 16px;
  }

  .identity {
    min-width: 0;
    gap: 9px;
  }

  .kind {
    display: grid;
    width: 28px;
    height: 28px;
    flex: none;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--accent);
    background: var(--surface);
  }

  .identity > div {
    min-width: 0;
  }

  h2 {
    overflow: hidden;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity p {
    min-width: 0;
    gap: 8px;
    margin-top: 3px;
    color: var(--text-faint);
    font-size: 11px;
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
    gap: 12px;
    margin: 15px 0 13px 37px;
  }

  .metrics strong {
    display: block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }

  footer {
    justify-content: space-between;
    gap: 12px;
    margin: 10px 0 0 37px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  footer span {
    gap: 4px;
  }

  footer code {
    color: var(--status-down);
  }

  @media (max-width: 680px) {
    .summary {
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
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
