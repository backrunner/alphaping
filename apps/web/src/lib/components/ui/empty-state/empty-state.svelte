<script lang="ts">
  import { Activity } from "@lucide/svelte";
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
    gap: var(--space-3);
    margin: var(--space-8) auto;
    padding: var(--space-8) var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    color: var(--text-faint);
    background: var(--surface);
    box-shadow: var(--shadow-card);
    text-align: center;
  }

  .empty-state.compact {
    margin-block: var(--space-6);
    padding-block: var(--space-6);
  }

  .empty-state__icon {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: var(--radius-panel);
    color: var(--accent);
    background: var(--surface-subtle);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    color: var(--text);
    font-size: 14px;
    font-weight: 600;
  }

  p {
    max-width: 42ch;
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .empty-state__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }
</style>
