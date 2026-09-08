<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";

  let {
    children,
    variant = "primary",
    class: className = "",
    type = "button",
    ...rest
  }: HTMLButtonAttributes & {
    children: import("svelte").Snippet;
    variant?: "primary" | "secondary" | "ghost";
  } = $props();
</script>

<button class={`button button--${variant} ${className}`} {type} {...rest}>
  {@render children()}
</button>

<style>
  .button {
    display: inline-flex;
    height: 36px;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-button);
    font: inherit;
    font-size: var(--text-base);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      transform 140ms ease;
  }

  .button:active {
    transform: translateY(0.5px);
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    transform: none;
  }

  .button--primary {
    color: var(--accent-ink);
    background: var(--accent);
    box-shadow: 0 1px 2px rgb(20 30 20 / 0.08);
  }

  .button--primary:hover {
    background: var(--accent-hover);
  }

  .button--secondary {
    color: var(--text);
    background: var(--surface);
    border-color: var(--border);
  }

  .button--secondary:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .button--ghost {
    color: var(--text-muted);
    background: transparent;
  }

  .button--ghost:hover {
    color: var(--text);
    background: var(--surface-subtle);
  }

  @media (prefers-reduced-motion: reduce) {
    .button {
      transition: none;
    }
  }
</style>
