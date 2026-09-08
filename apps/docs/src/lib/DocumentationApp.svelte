<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { onDestroy } from "svelte";
  import { DocsApp } from "svedocs/theme";
  import type { SvedocsAppProps } from "svedocs/theme/types";
  import themeComponents from "virtual:svedocs/theme-components";
  import loadSearch from "virtual:svedocs/search-loader";
  import Landing from "$lib/components/Landing.svelte";
  import { mountTableScrollMasks } from "$lib/table-scroll-masks";
  export let data: SvedocsAppProps;

  let clearTableScrollMasks = () => {};
  afterNavigate(() => {
    clearTableScrollMasks();
    clearTableScrollMasks = mountTableScrollMasks(document);
  });
  onDestroy(() => clearTableScrollMasks());
</script>

<DocsApp {...data} {themeComponents} {loadSearch}>
  <svelte:fragment slot="landing" let:context><Landing {context} /></svelte:fragment>
</DocsApp>
