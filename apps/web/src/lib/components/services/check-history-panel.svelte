<script lang="ts">
  import type { CheckHistoryPoint } from "@alphaping/db";
  import { AlertCircle, BarChart3, ChevronDown, RefreshCw } from "@lucide/svelte";

  let { endpoint }: { endpoint: string } = $props();

  const ranges = [
    { id: "1h", label: "1 hour", milliseconds: 3_600_000, resolution: "raw" },
    { id: "6h", label: "6 hours", milliseconds: 6 * 3_600_000, resolution: "raw" },
    { id: "24h", label: "24 hours", milliseconds: 86_400_000, resolution: "5m" },
    { id: "7d", label: "7 days", milliseconds: 7 * 86_400_000, resolution: "1h" },
    { id: "30d", label: "30 days", milliseconds: 30 * 86_400_000, resolution: "1h" },
  ] as const;
  const states = new Set(["healthy", "degraded", "down", "unknown"]);

  type CheckState = "healthy" | "degraded" | "down" | "unknown";
  type ChartPoint = { timestamp: number; state: CheckState; latencyMs: number | null };

  let selectedRange = $state<(typeof ranges)[number]>(ranges[0]);
  let loadState = $state<"idle" | "loading" | "loaded" | "error">("idle");
  let points = $state<readonly CheckHistoryPoint[]>([]);
  let errorMessage = $state("");

  const chartPoints = $derived(compact(points));
  const maximumLatency = $derived(Math.max(1, ...chartPoints.map((point) => point.latencyMs ?? 0)));

  function nullableNumber(value: unknown): value is number | null {
    return value === null || typeof value === "number";
  }

  function isPoint(value: unknown): value is CheckHistoryPoint {
    if (!value || typeof value !== "object") return false;
    const point = value as Record<string, unknown>;
    if (point.kind === "raw") {
      return (
        typeof point.observedAt === "number" &&
        typeof point.state === "string" &&
        states.has(point.state) &&
        nullableNumber(point.latencyMs) &&
        (point.failureCode === null || typeof point.failureCode === "string") &&
        (point.failureSummary === null || typeof point.failureSummary === "string")
      );
    }
    return (
      point.kind === "rollup" &&
      [
        "bucketStart",
        "totalCount",
        "healthyCount",
        "degradedCount",
        "downCount",
        "unknownCount",
      ].every((key) => typeof point[key] === "number") &&
      nullableNumber(point.latencyAverageMs) &&
      nullableNumber(point.latencyMaxMs)
    );
  }

  function parsePage(
    value: unknown,
  ): { points: readonly CheckHistoryPoint[]; nextCursor: string | null } | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as { points?: unknown; nextCursor?: unknown };
    if (
      !Array.isArray(candidate.points) ||
      !candidate.points.every(isPoint) ||
      (candidate.nextCursor !== null && typeof candidate.nextCursor !== "string")
    ) {
      return null;
    }
    return { points: candidate.points, nextCursor: candidate.nextCursor };
  }

  function normalized(point: CheckHistoryPoint): ChartPoint {
    if (point.kind === "raw") {
      return { timestamp: point.observedAt, state: point.state, latencyMs: point.latencyMs };
    }
    const state: CheckState =
      point.downCount > 0
        ? "down"
        : point.degradedCount > 0
          ? "degraded"
          : point.healthyCount > 0
            ? "healthy"
            : "unknown";
    return { timestamp: point.bucketStart, state, latencyMs: point.latencyAverageMs };
  }

  function rank(state: CheckState): number {
    return { unknown: 0, healthy: 1, degraded: 2, down: 3 }[state];
  }

  function compact(source: readonly CheckHistoryPoint[]): readonly ChartPoint[] {
    const normalizedPoints = source.map(normalized);
    const groupSize = Math.ceil(normalizedPoints.length / 120);
    if (groupSize <= 1) return normalizedPoints;
    const result: ChartPoint[] = [];
    for (let index = 0; index < normalizedPoints.length; index += groupSize) {
      const group = normalizedPoints.slice(index, index + groupSize);
      const first = group[0];
      if (!first) continue;
      const latencies = group.flatMap((point) =>
        point.latencyMs === null ? [] : [point.latencyMs],
      );
      result.push({
        timestamp: first.timestamp,
        state: group.reduce(
          (worst, point) => (rank(point.state) > rank(worst) ? point.state : worst),
          first.state,
        ),
        latencyMs:
          latencies.length === 0
            ? null
            : Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length),
      });
    }
    return result;
  }

  async function loadHistory() {
    loadState = "loading";
    errorMessage = "";
    const to = Date.now();
    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set("resolution", selectedRange.resolution);
    url.searchParams.set("from", String(to - selectedRange.milliseconds));
    url.searchParams.set("to", String(to));
    try {
      const loaded: CheckHistoryPoint[] = [];
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 8; pageNumber += 1) {
        if (cursor) url.searchParams.set("cursor", cursor);
        const response = await fetch(url, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("History request failed");
        const page = parsePage(await response.json());
        if (!page) throw new Error("History response is invalid");
        loaded.push(...page.points);
        cursor = page.nextCursor;
        if (cursor === null) break;
        if (pageNumber === 7) throw new Error("History response exceeded the page limit");
      }
      points = loaded;
      loadState = "loaded";
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : "History is unavailable";
      loadState = "error";
    }
  }

  function handleToggle(event: Event) {
    if (
      event.currentTarget instanceof HTMLDetailsElement &&
      event.currentTarget.open &&
      loadState === "idle"
    ) {
      void loadHistory();
    }
  }

  function selectRange(range: (typeof ranges)[number]) {
    selectedRange = range;
    if (loadState !== "idle") void loadHistory();
  }
</script>

<details class="history" ontoggle={handleToggle}>
  <summary>
    <span><BarChart3 size={12} />History</span><small>Load on demand</small><ChevronDown
      class="chevron"
      size={13}
    />
  </summary>
  <div class="body">
    <div class="ranges" aria-label="Check history range">
      {#each ranges as range}
        <button
          class:active={range.id === selectedRange.id}
          aria-pressed={range.id === selectedRange.id}
          disabled={loadState === "loading"}
          onclick={() => selectRange(range)}>{range.label}</button
        >
      {/each}
    </div>
    {#if loadState === "loading"}
      <div class="state" aria-busy="true"><RefreshCw class="spin" size={14} />Loading history</div>
    {:else if loadState === "error"}
      <div class="state error" role="alert">
        <AlertCircle size={14} /><span>{errorMessage}</span><button
          onclick={() => void loadHistory()}>Retry</button
        >
      </div>
    {:else if loadState === "loaded" && points.length === 0}
      <div class="state">No history is available for this range.</div>
    {:else if chartPoints.length > 0}
      <div class="charts">
        <section>
          <header><strong>State</strong><span>{selectedRange.label}</span></header>
          <div class="states" aria-hidden="true">
            {#each chartPoints as point (point.timestamp)}<i class={`status-${point.state}`}
              ></i>{/each}
          </div>
        </section>
        <section>
          <header><strong>Latency</strong><span>{maximumLatency} ms peak</span></header>
          <div class="bars" aria-hidden="true">
            {#each chartPoints as point (point.timestamp)}
              <i
                style={`--bar-height: ${Math.max(3, ((point.latencyMs ?? 0) / maximumLatency) * 100)}%`}
              ></i>
            {/each}
          </div>
        </section>
      </div>
      <table class="sr-only">
        <caption>Check history values</caption>
        <thead><tr><th>Time</th><th>Status</th><th>Latency</th></tr></thead>
        <tbody>
          {#each chartPoints as point (point.timestamp)}
            <tr
              ><td>{new Date(point.timestamp).toISOString()}</td><td>{point.state}</td><td
                >{point.latencyMs === null ? "No data" : `${point.latencyMs} ms`}</td
              ></tr
            >
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</details>

<style>
  .history {
    grid-column: 2 / -1;
  }
  summary {
    display: grid;
    width: 100%;
    height: 26px;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 7px;
    color: var(--accent);
    font-size: 9px;
    font-weight: 650;
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  summary small {
    color: var(--text-faint);
    font-size: 9px;
    font-weight: 400;
  }
  summary :global(.chevron) {
    transition: rotate 120ms ease;
  }
  details[open] summary :global(.chevron) {
    rotate: 180deg;
  }
  .body {
    min-height: 126px;
    padding: 8px 0 4px;
    border-top: 1px solid var(--border);
  }
  .ranges {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-bottom: 10px;
  }
  .ranges button,
  .state button {
    height: 24px;
    padding: 0 7px;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }
  .ranges button.active {
    color: var(--text);
    background: var(--surface-strong);
    font-weight: 650;
  }
  .ranges button:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  .state {
    display: flex;
    min-height: 86px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    color: var(--text-muted);
    font-size: 10px;
  }
  .state.error {
    color: var(--status-down);
  }
  .state button {
    border: 1px solid var(--border);
    color: var(--text);
    background: var(--surface);
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .charts header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .charts strong {
    font-size: 9px;
  }
  .charts header span {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 8px;
  }
  .states,
  .bars {
    display: flex;
    height: 64px;
    align-items: flex-end;
    gap: 1px;
    border-block: 1px solid var(--border);
  }
  .states i {
    min-width: 1px;
    height: 100%;
    flex: 1;
    background: var(--text-faint);
    opacity: 0.75;
  }
  .states i.status-healthy,
  .bars i {
    background: var(--status-healthy);
  }
  .states i.status-degraded {
    background: var(--status-degraded);
  }
  .states i.status-down {
    background: var(--status-down);
  }
  .bars i {
    min-width: 1px;
    height: var(--bar-height);
    flex: 1;
    opacity: 0.75;
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
  :global(.spin) {
    animation: spin 800ms linear infinite;
  }
  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
  @media (max-width: 640px) {
    .charts {
      grid-template-columns: 1fr;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    summary :global(.chevron) {
      transition: none;
    }
    :global(.spin) {
      animation: none;
    }
  }
</style>
