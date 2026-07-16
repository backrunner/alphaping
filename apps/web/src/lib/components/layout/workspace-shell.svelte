<script lang="ts">
  import { Tooltip } from "bits-ui";
  import type { Snippet } from "svelte";
  import type { WorkspaceShellData } from "@alphaping/db";

  import AppSidebar from "./app-sidebar.svelte";
  import AppTopbar from "./app-topbar.svelte";

  let { shell, children }: { shell: WorkspaceShellData; children: Snippet } = $props();
  let mobileNavOpen = $state(false);

  function closeMobileNavigation(): void {
    const shouldRestoreFocus = mobileNavOpen;
    mobileNavOpen = false;
    if (shouldRestoreFocus) {
      requestAnimationFrame(() => document.getElementById("workspace-mobile-menu")?.focus());
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!mobileNavOpen || event.key !== "Escape") return;
    event.preventDefault();
    closeMobileNavigation();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Tooltip.Provider delayDuration={300}>
  <div class="shell">
    <AppSidebar {shell} open={mobileNavOpen} onclose={closeMobileNavigation} />
    <div class="workspace">
      <AppTopbar {shell} menuOpen={mobileNavOpen} onmenu={() => (mobileNavOpen = true)} />
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
