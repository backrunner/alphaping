<script lang="ts">
  import DocumentationApp from "$lib/DocumentationApp.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<DocumentationApp {data} />
