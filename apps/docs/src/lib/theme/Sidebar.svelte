<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import { useSvedocsTheme } from "svedocs/theme/headless";
  import type { SvedocsSidebarProps } from "svedocs/theme/types";
  import type { SvedocsTreeItem } from "svedocs/core";
  let { items = [], currentPath = "", depth = 0 }: SvedocsSidebarProps = $props();
  const theme = useSvedocsTheme();
  const normalized = (path: string | undefined) => path?.replace(/\/$/, "");
  const active = (item: SvedocsTreeItem) => normalized(item.path) === normalized(currentPath);
  const containsActive = (item: SvedocsTreeItem): boolean =>
    active(item) || Boolean(item.children?.some(containsActive));
</script>

{#snippet branch(nodes: SvedocsTreeItem[], level: number)}
  <ul class="ap-sidebar-list" data-depth={level}>
    {#each nodes as item (item.id)}
      <li>
        {#if item.children?.length}
          <details class="ap-sidebar-group" open={containsActive(item) || !item.collapsed}>
            <summary><span>{item.title}</span><ChevronDown size={14} /></summary>
            {#if item.path}
              <a
                class="ap-sidebar-link"
                href={item.path}
                aria-current={active(item) ? "page" : undefined}
                >{$theme.t("ap.sidebar.overview")}</a
              >
            {/if}
            {@render branch(item.children, level + 1)}
          </details>
        {:else if item.path}
          <a
            class="ap-sidebar-link"
            href={item.path}
            aria-current={active(item) ? "page" : undefined}>{item.title}</a
          >
        {:else}
          <span class="ap-sidebar-label">{item.title}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{@render branch(items, depth)}
