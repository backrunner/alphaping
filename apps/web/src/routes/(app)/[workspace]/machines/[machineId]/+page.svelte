<script lang="ts">
  import { Activity, ArrowLeft } from "lucide-svelte";

  import MachineConfig from "$components/machines/machine-config.svelte";
  import MachineContainers from "$components/machines/machine-containers.svelte";
  import MachineEvents from "$components/machines/machine-events.svelte";
  import MachineOverview from "$components/machines/machine-overview.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { data } = $props();
  let activeTab = $state<"overview" | "probes" | "containers" | "events" | "config">("overview");

  const tabs = $derived([
    { id: "overview" as const, label: "Overview" },
    { id: "probes" as const, label: "Probe tasks" },
    ...(data.machine.containersEnabled ? [{ id: "containers" as const, label: "Containers" }] : []),
    { id: "events" as const, label: "Events" },
    ...(data.canManage ? [{ id: "config" as const, label: "Configuration" }] : []),
  ]);

  function handleTabKeydown(event: KeyboardEvent, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + offset + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    activeTab = next.id;
    requestAnimationFrame(() => document.getElementById(`machine-tab-${next.id}`)?.focus());
  }
</script>

<svelte:head><title>{data.machine.name} · {data.workspace.name}</title></svelte:head>

<main>
  <header class="page-header">
    <a href={`/${data.workspace.slug}/machines`}><ArrowLeft size={14} />Machines</a>
    <div class="title-row">
      <h1>{data.machine.name}</h1>
      <StatusLabel status={data.latest.state} />
    </div>
    <p>
      {data.agent ? `${data.agent.platform} · ${data.agent.arch}` : "Agent not enrolled"}
      <span>Last report {formatRelativeTime(data.latest.observedAt)}</span>
    </p>
  </header>

  <div class="tabs" role="tablist" aria-label="Machine details">
    {#each tabs as tab, index}
      <button
        id={`machine-tab-${tab.id}`}
        role="tab"
        aria-selected={activeTab === tab.id}
        aria-controls={`machine-panel-${tab.id}`}
        tabindex={activeTab === tab.id ? 0 : -1}
        class:active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
        onkeydown={(event) => handleTabKeydown(event, index)}>{tab.label}</button
      >
    {/each}
  </div>

  <div
    id={`machine-panel-${activeTab}`}
    class:empty={activeTab === "probes"}
    class="panel"
    role="tabpanel"
    aria-labelledby={`machine-tab-${activeTab}`}
  >
    {#if activeTab === "overview"}
      <MachineOverview detail={data} />
    {:else if activeTab === "probes"}
      <Activity size={24} />
      <h2>No probe results</h2>
      <p>Probe tasks assigned to this machine will appear here.</p>
    {:else if activeTab === "containers"}
      <MachineContainers inventory={data.containerInventory} />
    {:else if activeTab === "events"}
      <MachineEvents events={data.events} />
    {:else if activeTab === "config" && data.canManage}
      <MachineConfig machine={data.machine} />
    {/if}
  </div>
</main>

<style>
  main {
    width: min(100% - 24px, 1120px);
    margin: 0 auto;
    padding: 24px 0 48px;
  }

  .page-header {
    padding-bottom: 17px;
    border-bottom: 1px solid var(--border);
  }

  .page-header > a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: none;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 22px;
  }

  .page-header p {
    display: flex;
    gap: 9px;
    margin-top: 5px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .page-header p span::before {
    margin-right: 9px;
    content: "·";
  }

  .tabs {
    display: flex;
    overflow-x: auto;
    gap: 2px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    height: 28px;
    flex: none;
    padding: 0 9px;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .tabs button.active {
    color: var(--text);
    background: var(--surface-strong);
    font-weight: 650;
  }

  .panel {
    padding-top: 18px;
  }

  .panel.empty {
    display: grid;
    min-height: 280px;
    place-content: center;
    justify-items: center;
    gap: 7px;
    color: var(--text-faint);
  }

  .panel.empty h2 {
    font-size: 14px;
  }

  .panel.empty p {
    color: var(--text-muted);
    font-size: 10px;
  }

  @media (max-width: 520px) {
    .page-header p {
      align-items: flex-start;
      flex-direction: column;
      gap: 2px;
    }

    .page-header p span::before {
      display: none;
    }
  }
</style>
