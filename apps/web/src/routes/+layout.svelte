<script lang="ts">
  import "@fontsource-variable/geist";
  import "@fontsource-variable/geist-mono";
  import "../app.css";

  let { children } = $props();
</script>

<svelte:head>
  <title>AlphaPing</title>
  <meta name="description" content="Infrastructure and service monitoring control plane" />
</svelte:head>

{@render children()}
