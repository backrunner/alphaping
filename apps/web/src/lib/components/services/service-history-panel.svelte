<script lang="ts">
  import type { ServiceHistoryPoint } from "@alphaping/db";
  import { AlertCircle, BarChart3, ChevronDown, RefreshCw } from "@lucide/svelte";

  let { endpoint }: { endpoint: string } = $props();

  const ranges = [
    { id: "24h", label: "24 hours", milliseconds: 86_400_000, resolution: "5m" },
    { id: "7d", label: "7 days", milliseconds: 7 * 86_400_000, resolution: "1h" },
    { id: "30d", label: "30 days", milliseconds: 30 * 86_400_000, resolution: "1h" },
  ] as const;
  const states = new Set(["healthy", "degraded", "down", "maintenance", "unknown"]);

  let selectedRange = $state<(typeof ranges)[number]>(ranges[0]);
  let loadState = $state<"idle" | "loading" | "loaded" | "error">("idle");
  let points = $state<readonly ServiceHistoryPoint[]>([]);
  let errorMessage = $state("");

  const chartPoints = $derived(compact(points));
  const maximumLatency = $derived(
    Math.max(1, ...chartPoints.map((point) => point.latencyAverageMs ?? 0)),
  );

  function isNullableNumber(value: unknown): value is number | null {
    return value === null || typeof value === "number";
  }

  function isPoint(value: unknown): value is ServiceHistoryPoint {
    if (!value || typeof value !== "object") return false;
    const point = value as Record<string, unknown>;
    return (
      typeof point.bucketStart === "number" &&
      typeof point.availabilityPermille === "number" &&
      typeof point.state === "string" &&
      states.has(point.state) &&
      isNullableNumber(point.latencyAverageMs) &&
      isNullableNumber(point.latencyMaxMs) &&
      (point.summaryCode === null || typeof point.summaryCode === "string")
    );
  }

  function parsePage(
    value: unknown,
  ): { points: readonly ServiceHistoryPoint[]; nextCursor: string | null } | null {
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

  function severity(state: ServiceHistoryPoint["state"]): number {
    return { unknown: 0, healthy: 1, degraded: 2, down: 3, maintenance: 4 }[state];
  }

  function compact(source: readonly ServiceHistoryPoint[]): readonly ServiceHistoryPoint[] {
    const groupSize = Math.ceil(source.length / 120);
    if (groupSize <= 1) return source;
    const result: ServiceHistoryPoint[] = [];
    for (let index = 0; index < source.length; index += groupSize) {
      const group = source.slice(index, index + groupSize);
      const first = group[0];
      if (!first) continue;
      const latencies = group.flatMap((point) =>
        point.latencyAverageMs === null ? [] : [point.latencyAverageMs],
      );
      result.push({
        bucketStart: first.bucketStart,
        state: group.reduce(
          (worst, point) => (severity(point.state) > severity(worst) ? point.state : worst),
          first.state,
        ),
        availabilityPermille: Math.round(
          group.reduce((total, point) => total + point.availabilityPermille, 0) / group.length,
        ),
        latencyAverageMs:
          latencies.length === 0
            ? null
            : Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length),
        latencyMaxMs: Math.max(...group.map((point) => point.latencyMaxMs ?? 0)) || null,
        summaryCode: null,
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
      const loaded: ServiceHistoryPoint[] = [];
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

<details ontoggle={handleToggle}>
  <summary>
    <span><BarChart3 size={15} />Service history</span>
    <small>Load on demand</small>
    <ChevronDown class="chevron" size={15} />
  </summary>
  <div class="body">
    <div class="ranges" aria-label="Service history range">
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
      <div class="state" aria-busy="true"><RefreshCw class="spin" size={17} />Loading history</div>
    {:else if loadState === "error"}
      <div class="state error" role="alert">
        <AlertCircle size={17} /><span>{errorMessage}</span><button
          onclick={() => void loadHistory()}>Retry</button
        >
      </div>
    {:else if loadState === "loaded" && points.length === 0}
      <div class="state">No history is available for this range.</div>
    {:else if chartPoints.length > 0}
      <div class="charts">
        <section>
          <header><strong>Availability</strong><span>{selectedRange.label}</span></header>
          <div class="bars" aria-hidden="true">
            {#each chartPoints as point (point.bucketStart)}
              <i
                class={`status-${point.state}`}
                style={`--bar-height: ${Math.max(3, point.availabilityPermille / 10)}%`}
              ></i>
            {/each}
          </div>
        </section>
        <section>
          <header><strong>Average latency</strong><span>{maximumLatency} ms peak</span></header>
          <div class="bars latency" aria-hidden="true">
            {#each chartPoints as point (point.bucketStart)}
              <i
                style={`--bar-height: ${Math.max(3, ((point.latencyAverageMs ?? 0) / maximumLatency) * 100)}%`}
              ></i>
            {/each}
          </div>
        </section>
      </div>
      <table class="sr-only">
        <caption>Service history values</caption>
        <thead><tr><th>Time</th><th>Status</th><th>Availability</th><th>Latency</th></tr></thead>
        <tbody>
          {#each points as point (point.bucketStart)}
            <tr>
              <td>{new Date(point.bucketStart).toISOString()}</td><td>{point.state}</td><td
                >{(point.availabilityPermille / 10).toFixed(1)}%</td
              ><td
                >{point.latencyAverageMs === null ? "No data" : `${point.latencyAverageMs} ms`}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</details>

<style>
  details {
    margin-top: var(--space-4);
    border-block: 1px solid var(--border);
  }
  summary {
    display: grid;
    height: 44px;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary > span {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 14px;
    font-weight: 600;
  }
  summary > span :global(svg) {
    color: var(--text-muted);
  }
  summary small {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  summary :global(.chevron) {
    color: var(--text-faint);
    transition: rotate 120ms ease;
  }
  details[open] summary :global(.chevron) {
    rotate: 180deg;
  }
  .body {
    min-height: 156px;
    padding-bottom: var(--space-4);
  }
  .ranges {
    display: flex;
    gap: 2px;
    margin-bottom: var(--space-3);
  }
  .ranges button,
  .state button {
    height: 28px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  .ranges button:hover {
    color: var(--text);
  }
  .ranges button.active {
    color: var(--text);
    background: var(--surface-strong);
    font-weight: 620;
  }
  .ranges button:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  .state {
    display: flex;
    min-height: 116px;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .state.error {
    color: var(--status-down);
  }
  .state button {
    border: 1px solid var(--border);
    color: var(--text);
    background: var(--surface);
  }
  .state button:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .charts header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .charts strong {
    font-size: var(--text-xs);
    font-weight: 620;
  }
  .charts header span {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .bars {
    display: flex;
    height: 88px;
    align-items: flex-end;
    gap: 1px;
    padding-top: var(--space-2);
    border-block: 1px solid var(--border);
  }
  .bars i {
    min-width: 1px;
    height: var(--bar-height);
    flex: 1;
    border-radius: 2px 2px 0 0;
    background: var(--text-faint);
    opacity: 0.8;
  }
  .bars i.status-healthy {
    background: var(--status-healthy);
  }
  .latency i {
    background: var(--accent);
    opacity: 0.7;
  }
  .bars i.status-degraded {
    background: var(--status-degraded);
  }
  .bars i.status-down {
    background: var(--status-down);
  }
  .bars i.status-maintenance {
    background: var(--status-maintenance);
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
