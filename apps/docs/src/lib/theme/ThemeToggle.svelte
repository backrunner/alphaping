<script lang="ts">
  import { onMount } from "svelte";
  import { Moon, Sun } from "@lucide/svelte";
  import { createThemeModeController, fallbackTranslate } from "svedocs/theme/headless";
  import type { SvedocsThemeToggleProps } from "svedocs/theme/types";

  let { context }: SvedocsThemeToggleProps = $props();
  const controller = createThemeModeController("system");
  let mode = $state<"light" | "dark">("light");
  const t = $derived(context?.t ?? fallbackTranslate);
  const label = $derived(
    t("theme.switch", { mode: t(mode === "dark" ? "theme.light" : "theme.dark") }),
  );
  onMount(() => {
    const unsubscribe = controller.mode.subscribe((value) => (mode = value));
    const unmount = controller.mount();
    return () => {
      unsubscribe();
      unmount();
    };
  });
</script>

<button
  class="ap-icon-button ap-theme-toggle"
  type="button"
  aria-label={label}
  title={label}
  onclick={controller.toggle}
>
  {#if mode === "dark"}<Sun size={18} aria-hidden="true" />
  {:else}<Moon size={18} aria-hidden="true" />{/if}
</button>
