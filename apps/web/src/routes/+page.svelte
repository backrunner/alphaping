<script lang="ts">
  import PublicStatusPage from "./status/[workspace]/+page.svelte";
  import PublicMachineStatusPage from "./status/[workspace]/machines/[machineId]/+page.svelte";
  import PublicServiceStatusPage from "./status/[workspace]/services/[serviceSlug]/+page.svelte";

  let { data } = $props();
</script>

{#if data.kind === "status"}
  <PublicStatusPage data={data.page} />
{:else if data.kind === "machine"}
  <PublicMachineStatusPage data={data.page} />
{:else}
  <PublicServiceStatusPage data={data.page} />
{/if}
