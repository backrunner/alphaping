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
    height: 32px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 5px;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      transform 80ms ease;
  }

  .button:active {
    transform: translateY(1px);
  }

  .button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .button--primary {
    color: white;
    background: var(--accent);
  }

  .button--primary:hover {
    background: var(--accent-hover);
  }

  .button--secondary {
    color: var(--text);
    background: var(--surface);
    border-color: var(--border);
  }

  .button--secondary:hover,
  .button--ghost:hover {
    background: var(--surface-subtle);
  }

  .button--ghost {
    color: var(--text-muted);
    background: transparent;
  }
</style>
