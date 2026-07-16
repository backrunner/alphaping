<script lang="ts">
  import WorkspaceShell from "$components/layout/workspace-shell.svelte";

  let { data, children } = $props();
</script>

<WorkspaceShell shell={data.shell}>{@render children()}</WorkspaceShell>
