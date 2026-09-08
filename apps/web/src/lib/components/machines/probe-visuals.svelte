<script lang="ts">
  import type { MachineProbeTask } from "@alphaping/db";

  let { task }: { task: MachineProbeTask } = $props();

  const points = $derived.by(() => {
    const byBucket = new Map(task.history.map((point) => [point.bucketStart, point]));
    const end = Math.floor(Date.now() / 300_000) * 300_000;
    return Array.from({ length: 12 }, (_, index) => {
      const bucketStart = end - (11 - index) * 300_000;
      return (
        byBucket.get(bucketStart) ?? {
          bucketStart,
          state: "unknown" as const,
          availabilityPermille: 0,
          latencyAvgMs: null,
          latencyMaxMs: null,
        }
      );
    });
  });
  const maximumLatency = $derived(
    Math.max(1, ...task.history.map((point) => point.latencyMaxMs ?? 0)),
  );

  function latencyHeight(latency: number | null): number {
    return latency === null ? 3 : Math.max(5, Math.min(100, (latency / maximumLatency) * 100));
  }
</script>

<div class="visuals">
  <div class="timeline" aria-label="Last hour status">
    {#each points as point (point.bucketStart)}
      <i
        class={`state state--${point.state}`}
        title={`${new Date(point.bucketStart).toLocaleTimeString()}: ${point.state}`}
      ></i>
    {/each}
  </div>
  <div class="latency" aria-label="Last hour average latency">
    {#each points as point (point.bucketStart)}
      <i
        class:missing={point.latencyAvgMs === null}
        style={`--height: ${latencyHeight(point.latencyAvgMs)}%`}
        title={point.latencyAvgMs === null ? "No latency sample" : `${point.latencyAvgMs} ms`}
      ></i>
    {/each}
  </div>
</div>

<style>
  .visuals {
    display: grid;
    grid-template-columns: minmax(0, 1.8fr) minmax(160px, 1fr);
    gap: var(--space-4);
    margin-left: 36px;
  }

  .timeline {
    display: grid;
    height: 22px;
    grid-template-columns: repeat(12, minmax(4px, 1fr));
    gap: 3px;
  }

  .state {
    border-radius: var(--radius-pill);
    background: var(--surface-strong);
  }

  .state--healthy {
    background: var(--status-healthy);
  }

  .state--degraded {
    background: var(--status-degraded);
  }

  .state--down {
    background: var(--status-down);
  }

  .latency {
    display: flex;
    height: 22px;
    align-items: end;
    gap: 3px;
    border-bottom: 1px solid var(--border);
  }

  .latency i {
    width: 100%;
    height: var(--height);
    min-height: 2px;
    background: var(--accent);
  }

  .latency i.missing {
    background: var(--surface-strong);
  }

  @media (max-width: 680px) {
    .visuals {
      grid-template-columns: 1fr;
      gap: var(--space-2);
      margin-left: 0;
    }
  }
</style>
