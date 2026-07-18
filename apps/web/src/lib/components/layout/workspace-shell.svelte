<script lang="ts">
  import { Tooltip } from "bits-ui";
  import type { Snippet } from "svelte";
  import type { WorkspaceShellData } from "@alphaping/db";

  import AppSidebar from "./app-sidebar.svelte";
  import AppTopbar from "./app-topbar.svelte";

  let { shell, children }: { shell: WorkspaceShellData; children: Snippet } = $props();
  let mobileNavOpen = $state(false);

  function openMobileNavigation(): void {
    mobileNavOpen = true;
    requestAnimationFrame(() => document.getElementById("workspace-navigation-close")?.focus());
  }

  function closeMobileNavigation(): void {
    const shouldRestoreFocus = mobileNavOpen;
    mobileNavOpen = false;
    if (shouldRestoreFocus) {
      requestAnimationFrame(() => document.getElementById("workspace-mobile-menu")?.focus());
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!mobileNavOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileNavigation();
      return;
    }
    if (event.key !== "Tab") return;
    const navigation = document.getElementById("workspace-navigation");
    const focusable = navigation
      ? [...navigation.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter(
          (element) => element.offsetParent !== null,
        )
      : [];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Tooltip.Provider delayDuration={300}>
  <div class="shell">
    <AppSidebar {shell} open={mobileNavOpen} onclose={closeMobileNavigation} />
    <div class="workspace" inert={mobileNavOpen}>
      <AppTopbar {shell} menuOpen={mobileNavOpen} onmenu={openMobileNavigation} />
      <div class="workspace-content">{@render children()}</div>
    </div>
  </div>
</Tooltip.Provider>

<style>
  .shell {
    display: grid;
    min-height: 100dvh;
    grid-template-columns: 216px minmax(0, 1fr);
  }

  .workspace,
  .workspace-content {
    min-width: 0;
  }

  @media (max-width: 780px) {
    .shell {
      grid-template-columns: 1fr;
    }
  }
</style>
