<script lang="ts">
  type State = "healthy" | "degraded" | "down" | "maintenance" | "unknown";
  type Bucket = {
    bucketStart: number;
    state: State;
    availabilityPermille?: number | null;
    latencyMs?: number | null;
    summaryCode?: string | null;
  };

  let {
    buckets,
    label,
    compact = false,
  }: { buckets: readonly Bucket[]; label: string; compact?: boolean } = $props();
  let activeIndex = $state(0);
  let capsuleButtons: HTMLButtonElement[] = [];

  const stateLabel: Readonly<Record<State, string>> = {
    healthy: "Healthy",
    degraded: "Degraded",
    down: "Fault",
    maintenance: "Maintenance",
    unknown: "No data",
  };

  function details(bucket: Bucket): string {
    const time = new Date(bucket.bucketStart).toLocaleString();
    const availability =
      bucket.availabilityPermille === null || bucket.availabilityPermille === undefined
        ? "No availability data"
        : `${(bucket.availabilityPermille / 10).toFixed(1)}% available`;
    const latency =
      bucket.latencyMs === null || bucket.latencyMs === undefined
        ? "No latency data"
        : `${bucket.latencyMs} ms`;
    return `${time} · ${stateLabel[bucket.state]} · ${availability} · ${latency}`;
  }

  function focusBucket(index: number): void {
    const nextIndex = Math.max(0, Math.min(index, buckets.length - 1));
    activeIndex = nextIndex;
    capsuleButtons[nextIndex]?.focus();
  }

  function handleKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusBucket(index - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusBucket(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusBucket(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusBucket(buckets.length - 1);
    }
  }
</script>

<div class:compact class="capsules" role="group" aria-label={label}>
  {#each buckets as bucket, index (bucket.bucketStart)}
    <button
      bind:this={capsuleButtons[index]}
      type="button"
      class={`capsule capsule--${bucket.state}`}
      aria-label={details(bucket)}
      title={details(bucket)}
      tabindex={index === activeIndex ? 0 : -1}
      onfocus={() => (activeIndex = index)}
      onkeydown={(event) => handleKeydown(event, index)}
    ></button>
  {/each}
</div>

<style>
  .capsules {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(var(--capsule-count, 48), minmax(3px, 1fr));
    gap: 3px;
  }

  .capsule {
    display: block;
    width: 100%;
    height: 24px;
    border: 0;
    border-radius: 999px;
    outline: 0;
    background: var(--surface-strong);
  }

  .compact .capsule {
    height: 20px;
  }

  .capsule:focus-visible {
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 0 3px var(--surface);
  }

  .capsule--healthy {
    background: var(--status-healthy);
  }
  .capsule--degraded {
    background: var(--status-degraded);
  }
  .capsule--down {
    background: var(--status-down);
  }
  .capsule--maintenance {
    background: var(--status-maintenance);
  }
  .capsule--unknown {
    background: repeating-linear-gradient(
      45deg,
      var(--surface-strong),
      var(--surface-strong) 2px,
      var(--border-strong) 2px,
      var(--border-strong) 3px
    );
  }
</style>
