<script lang="ts">
  import { AlertCircle, BarChart3, ChevronDown, RefreshCw } from "lucide-svelte";
  import type { MachineHistoryPoint } from "@alphaping/db";

  import MachineHistoryCharts from "$components/machines/machine-history-charts.svelte";

  export type MachineMetric = "cpu" | "memory" | "storage" | "network";

  let {
    endpoint,
    selectedMetric = $bindable<MachineMetric | null>(null),
  }: { endpoint: string; selectedMetric?: MachineMetric | null } = $props();

  const ranges = [
    { id: "1h", label: "1 hour", milliseconds: 3_600_000, resolution: "raw" },
    { id: "6h", label: "6 hours", milliseconds: 6 * 3_600_000, resolution: "raw" },
    { id: "24h", label: "24 hours", milliseconds: 24 * 3_600_000, resolution: "5m" },
    { id: "7d", label: "7 days", milliseconds: 7 * 86_400_000, resolution: "1h" },
    { id: "30d", label: "30 days", milliseconds: 30 * 86_400_000, resolution: "1h" },
  ] as const;

  let selectedRange = $state<(typeof ranges)[number]>(ranges[0]);
  let loadState = $state<"idle" | "loading" | "loaded" | "error">("idle");
  let points = $state<readonly MachineHistoryPoint[]>([]);
  let errorMessage = $state("");
  let historyOpen = $state(false);

  $effect(() => {
    if (selectedMetric !== null) {
      historyOpen = true;
      if (loadState === "idle") void loadHistory();
    }
  });

  function isHistoryPoint(value: unknown): value is MachineHistoryPoint {
    if (!value || typeof value !== "object") return false;
    const point = value as Record<string, unknown>;
    const required = [
      "bucketStart",
      "sampleCount",
      "cpuAveragePermille",
      "cpuMaxPermille",
      "memoryAverageBytes",
      "storageMaxBytes",
      "networkRxBytes",
      "networkTxBytes",
    ].every((key) => typeof point[key] === "number");
    const nullable = [
      "memoryTotalBytes",
      "storageTotalBytes",
      "networkRxBps",
      "networkTxBps",
      "load1mMilli",
      "uptimeSeconds",
    ].every((key) => point[key] === null || typeof point[key] === "number");
    return required && nullable;
  }

  function parsePage(
    value: unknown,
  ): { points: readonly MachineHistoryPoint[]; nextCursor: string | null } | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as { points?: unknown; nextCursor?: unknown };
    if (
      !Array.isArray(candidate.points) ||
      !candidate.points.every(isHistoryPoint) ||
      (candidate.nextCursor !== null && typeof candidate.nextCursor !== "string")
    ) {
      return null;
    }
    return { points: candidate.points, nextCursor: candidate.nextCursor };
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
      const loaded: MachineHistoryPoint[] = [];
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

<details bind:open={historyOpen} ontoggle={handleToggle}>
  <summary>
    <span><BarChart3 size={15} />History</span>
    <small>Load on demand</small>
    <ChevronDown class="chevron" size={15} />
  </summary>

  <div class="body">
    <div class="ranges" aria-label="History range">
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
        <AlertCircle size={17} /><span>{errorMessage}</span>
        <button onclick={() => void loadHistory()}>Retry</button>
      </div>
    {:else if loadState === "loaded" && points.length === 0}
      <div class="state">No history is available for this range.</div>
    {:else if points.length > 0}
      <MachineHistoryCharts
        {points}
        rangeLabel={selectedRange.label}
        activeMetric={selectedMetric}
      />
    {/if}
  </div>
</details>

<style>
  details {
    border-block: 1px solid var(--border);
  }

  summary {
    display: grid;
    height: 44px;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 9px;
    list-style: none;
    cursor: pointer;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary > span {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 650;
  }

  summary small {
    color: var(--text-faint);
    font-size: 10px;
  }

  summary :global(.chevron) {
    transition: rotate 120ms ease;
  }

  details[open] summary :global(.chevron) {
    rotate: 180deg;
  }

  .body {
    min-height: 156px;
    padding: 0 0 16px;
  }

  .ranges {
    display: flex;
    gap: 2px;
    margin-bottom: 12px;
  }

  .ranges button,
  .state button {
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: 10px;
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
    min-height: 116px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .state.error {
    color: var(--status-down);
  }

  .state button {
    border: 1px solid var(--border);
    color: var(--text);
    background: var(--surface);
  }

  :global(.spin) {
    animation: spin 800ms linear infinite;
  }

  @keyframes spin {
    to {
      rotate: 360deg;
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
