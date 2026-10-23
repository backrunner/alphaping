<script lang="ts">
  import { onMount } from "svelte";
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
  const id = $props.id();
  let inspected = $state<number | null>(null);
  const inspectedBucket = $derived(inspected === null ? undefined : buckets[inspected]);
  let activeIndex = $state(0);
  let touchTimeline = $state(false);
  onMount(() => {
    const query = matchMedia("(max-width: 780px), (pointer: coarse)");
    const update = () => {
      touchTimeline = query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });
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

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") inspected = null;
  }}
/>

<div
  class="timeline-wrap"
  role="presentation"
  onpointerleave={(event) => {
    if (!event.currentTarget.contains(document.activeElement)) inspected = null;
  }}
>
  <div
    class:compact
    class:touch-timeline={touchTimeline}
    class="capsules"
    style:--capsule-count={Math.max(1, buckets.length)}
    role="group"
    aria-label={label}
  >
    {#each buckets as bucket, index (bucket.bucketStart)}
      <button
        bind:this={capsuleButtons[index]}
        type="button"
        class={`capsule capsule--${bucket.state}`}
        aria-hidden={touchTimeline}
        aria-label={details(bucket)}
        class:inspected={inspected === index}
        aria-describedby={inspected === index ? `${id}-tooltip` : undefined}
        onpointerenter={() => (inspected = index)}
        onclick={() => (inspected = index)}
        onblur={() => (inspected = null)}
        tabindex={!touchTimeline && index === activeIndex ? 0 : -1}
        onfocus={() => {
          activeIndex = index;
          inspected = index;
        }}
        onkeydown={(event) => handleKeydown(event, index)}
      ></button>
    {/each}
  </div>
  {#if touchTimeline && buckets.length > 0}
    <input
      class="timeline-range"
      type="range"
      min="0"
      max={buckets.length - 1}
      step="1"
      value={activeIndex}
      aria-label={label}
      aria-valuetext={details(buckets[activeIndex] ?? buckets[0]!)}
      oninput={(event) => {
        activeIndex = Number(event.currentTarget.value);
        inspected = activeIndex;
      }}
      onfocus={() => (inspected = activeIndex)}
      onblur={() => (inspected = null)}
    />
  {/if}
  {#if inspectedBucket}<div class="bucket-tooltip" id={`${id}-tooltip`} role="tooltip">
      {details(inspectedBucket)}
    </div>{/if}
</div>

<style>
  .timeline-wrap {
    position: relative;
    min-width: 0;
  }
  .bucket-tooltip {
    position: absolute;
    z-index: var(--z-popover);
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    width: min(260px, 100%);
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    font-size: 11px;
    line-height: 1.65;
  }
  .bucket-tooltip::after {
    content: "";
    position: absolute;
    inset: 100% 0 -12px;
  }
  .capsules {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(var(--capsule-count, 48), minmax(0, 1fr));
    gap: 2px;
  }

  .capsule {
    display: block;
    min-width: 0;
    width: 100%;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    outline: 0;
    background: var(--surface-strong);
    transition: background-color 150ms ease;
  }

  .compact .capsule {
    height: 20px;
  }

  .capsule.inspected,
  .capsule:hover {
    outline: 2px solid var(--border-strong);
    outline-offset: 1px;
  }

  .capsule:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
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
  .touch-timeline {
    min-height: 44px;
    align-items: center;
  }
  .timeline-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 44px;
    margin: 0;
    opacity: 0;
    cursor: ew-resize;
  }
  .timeline-wrap:has(.timeline-range:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 3px;
    border-radius: 5px;
  }
</style>
