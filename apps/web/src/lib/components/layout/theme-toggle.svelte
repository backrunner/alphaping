<script lang="ts">
  import { onMount } from "svelte";
  import { Monitor, Moon, Sun } from "@lucide/svelte";

  type ThemeChoice = "system" | "light" | "dark";

  const labels: Record<ThemeChoice, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
  };

  let theme: ThemeChoice = $state("system");

  let label = $derived(`Switch theme (current: ${labels[theme]})`);

  onMount(() => {
    const current = document.documentElement.dataset.theme;
    theme = current === "light" || current === "dark" ? current : "system";
  });

  function cycle() {
    const next: ThemeChoice = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    theme = next;
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = next;
    }
    try {
      if (next === "system") {
        localStorage.removeItem("theme");
      } else {
        localStorage.setItem("theme", next);
      }
    } catch {
      // localStorage unavailable; the theme still applies for this session.
    }
  }
</script>

<button class="theme-toggle" type="button" aria-label={label} title={label} onclick={cycle}>
  {#if theme === "light"}
    <Sun size={15} />
  {:else if theme === "dark"}
    <Moon size={15} />
  {:else}
    <Monitor size={15} />
  {/if}
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    width: 36px;
    height: 36px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: transparent;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .theme-toggle:hover {
    color: var(--text);
    background: var(--surface-subtle);
  }

  .theme-toggle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
</style>
