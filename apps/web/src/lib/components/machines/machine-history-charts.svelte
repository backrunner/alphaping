<script lang="ts">
  import type { MachineHistoryPoint } from "@alphaping/db";

  import { formatBytes } from "$lib/utils/format";

  let { points, rangeLabel }: { points: readonly MachineHistoryPoint[]; rangeLabel: string } =
    $props();

  const chartPoints = $derived(compactPoints(points));
  const usesThroughput = $derived(points.some((point) => point.networkRxBps !== null));
  const maximumMemory = $derived(Math.max(1, ...points.map((point) => point.memoryAverageBytes)));
  const maximumNetwork = $derived(Math.max(1, ...chartPoints.map(networkValue)));

  function averageNullable(values: readonly (number | null)[]): number | null {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0
      ? null
      : Math.round(present.reduce((total, value) => total + value, 0) / present.length);
  }

  function networkValue(point: MachineHistoryPoint): number {
    return usesThroughput
      ? (point.networkRxBps ?? 0) + (point.networkTxBps ?? 0)
      : point.networkRxBytes + point.networkTxBytes;
  }

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
        memoryTotalBytes: Math.max(...group.map((point) => point.memoryTotalBytes ?? 0)) || null,
        storageMaxBytes: Math.max(...group.map((point) => point.storageMaxBytes)),
        storageTotalBytes: Math.max(...group.map((point) => point.storageTotalBytes ?? 0)) || null,
        networkRxBytes: group.reduce((total, point) => total + point.networkRxBytes, 0),
        networkTxBytes: group.reduce((total, point) => total + point.networkTxBytes, 0),
        networkRxBps: averageNullable(group.map((point) => point.networkRxBps)),
        networkTxBps: averageNullable(group.map((point) => point.networkTxBps)),
        load1mMilli: averageNullable(group.map((point) => point.load1mMilli)),
        uptimeSeconds: group.at(-1)?.uptimeSeconds ?? null,
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
    <header>
      <strong>{usesThroughput ? "Network throughput" : "Network volume"}</strong><span
        >download + upload</span
      >
    </header>
    <div class="bars bars--network" aria-hidden="true">
      {#each chartPoints as point (point.bucketStart)}
        <i style={`--bar-height: ${Math.max(3, (networkValue(point) / maximumNetwork) * 100)}%`}
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
        <td>{formatBytes(networkValue(point))}{usesThroughput ? "/s" : ""}</td>
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
