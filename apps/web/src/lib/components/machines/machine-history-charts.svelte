<script lang="ts">
  import type { MachineHistoryPoint } from "@alphaping/db";

  import { formatBytes } from "$lib/utils/format";

  let { points, rangeLabel }: { points: readonly MachineHistoryPoint[]; rangeLabel: string } =
    $props();

  const chartPoints = $derived(compactPoints(points));
  const maximumMemory = $derived(Math.max(1, ...points.map((point) => point.memoryAverageBytes)));
  const maximumNetwork = $derived(
    Math.max(1, ...chartPoints.map((point) => point.networkRxBytes + point.networkTxBytes)),
  );

  function compactPoints(source: readonly MachineHistoryPoint[]): readonly MachineHistoryPoint[] {
    const groupSize = Math.ceil(source.length / 120);
    if (groupSize <= 1) return source;
    const compacted: MachineHistoryPoint[] = [];
    for (let index = 0; index < source.length; index += groupSize) {
      const group = source.slice(index, index + groupSize);
      const first = group[0];
      if (!first) continue;
      const sampleCount = group.reduce((total, point) => total + point.sampleCount, 0);
      const divisor = Math.max(1, sampleCount);
      compacted.push({
        bucketStart: first.bucketStart,
        sampleCount,
        cpuAveragePermille: Math.round(
          group.reduce((total, point) => total + point.cpuAveragePermille * point.sampleCount, 0) /
            divisor,
        ),
        cpuMaxPermille: Math.max(...group.map((point) => point.cpuMaxPermille)),
        memoryAverageBytes: Math.round(
          group.reduce((total, point) => total + point.memoryAverageBytes * point.sampleCount, 0) /
            divisor,
        ),
        storageMaxBytes: Math.max(...group.map((point) => point.storageMaxBytes)),
        networkRxBytes: group.reduce((total, point) => total + point.networkRxBytes, 0),
        networkTxBytes: group.reduce((total, point) => total + point.networkTxBytes, 0),
      });
    }
    return compacted;
  }

  function formatBucket(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  }
</script>

<div class="charts">
  <section>
    <header><strong>CPU average</strong><span>{rangeLabel}</span></header>
    <div class="bars" aria-hidden="true">
      {#each chartPoints as point (point.bucketStart)}
        <i style={`--bar-height: ${Math.max(3, Math.min(100, point.cpuAveragePermille / 10))}%`}
        ></i>
      {/each}
    </div>
  </section>
  <section>
    <header><strong>Memory</strong><span>{formatBytes(maximumMemory)} peak</span></header>
    <div class="bars bars--memory" aria-hidden="true">
      {#each chartPoints as point (point.bucketStart)}
        <i style={`--bar-height: ${Math.max(3, (point.memoryAverageBytes / maximumMemory) * 100)}%`}
        ></i>
      {/each}
    </div>
  </section>
  <section>
    <header><strong>Network volume</strong><span>download + upload</span></header>
    <div class="bars bars--network" aria-hidden="true">
      {#each chartPoints as point (point.bucketStart)}
        <i
          style={`--bar-height: ${Math.max(3, ((point.networkRxBytes + point.networkTxBytes) / maximumNetwork) * 100)}%`}
        ></i>
      {/each}
    </div>
  </section>
</div>

<table class="sr-only">
  <caption>Machine history values</caption>
  <thead><tr><th>Time</th><th>CPU</th><th>Memory</th><th>Network</th></tr></thead>
  <tbody>
    {#each points as point (point.bucketStart)}
      <tr>
        <td>{formatBucket(point.bucketStart)}</td>
        <td>{(point.cpuAveragePermille / 10).toFixed(1)}%</td>
        <td>{formatBytes(point.memoryAverageBytes)}</td>
        <td>{formatBytes(point.networkRxBytes + point.networkTxBytes)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .charts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }

  section {
    min-width: 0;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
  }

  strong {
    font-size: 10px;
  }

  header span {
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bars {
    display: flex;
    height: 88px;
    align-items: flex-end;
    gap: 1px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border-strong);
  }

  .bars i {
    min-width: 1px;
    height: var(--bar-height);
    flex: 1;
    background: var(--accent);
    opacity: 0.75;
  }

  .bars--memory i {
    background: var(--status-maintenance);
  }

  .bars--network i {
    background: var(--status-healthy);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    clip-path: inset(50%);
  }

  @media (max-width: 760px) {
    .charts {
      grid-template-columns: 1fr;
    }
  }
</style>
