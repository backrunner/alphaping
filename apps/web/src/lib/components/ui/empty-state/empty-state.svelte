<script lang="ts">
  import { Activity } from "lucide-svelte";
  import type { Snippet } from "svelte";

  let {
    icon: Icon,
    title,
    description,
    children,
    compact = false,
  }: {
    icon: typeof Activity;
    title: string;
    description: string;
    children?: Snippet;
    compact?: boolean;
  } = $props();
</script>

<section class:compact class="empty-state">
  <span class="empty-state__icon"><Icon size={compact ? 20 : 24} aria-hidden="true" /></span>
  <div>
    <h2>{title}</h2>
    <p>{description}</p>
  </div>
  {#if children}<div class="empty-state__actions">{@render children()}</div>{/if}
</section>

<style>
  .empty-state {
    display: grid;
    width: min(100%, 520px);
    justify-items: center;
    gap: 12px;
    margin: 52px auto;
    padding: 34px 28px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    color: var(--text-faint);
    background: var(--surface);
    box-shadow: var(--shadow-card);
    text-align: center;
  }

  .empty-state.compact {
    margin-block: 24px;
    padding-block: 26px;
  }

  .empty-state__icon {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 12px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    color: var(--text);
    font-size: 15px;
  }

  p {
    max-width: 42ch;
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .empty-state__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
</style>
