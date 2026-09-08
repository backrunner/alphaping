<script lang="ts">
  import { ArrowLeft, Trash2 } from "@lucide/svelte";
  import { Tabs } from "bits-ui";
  import type { LiveViewerSnapshot } from "@alphaping/contracts";
  import type { DashboardMachine } from "@alphaping/db";

  import AgentUpdateControls from "$components/machines/agent-update-controls.svelte";
  import MachineConfig from "$components/machines/machine-config.svelte";
  import MachineContainers from "$components/machines/machine-containers.svelte";
  import MachineEvents from "$components/machines/machine-events.svelte";
  import MachineEnrollment from "$components/machines/machine-enrollment.svelte";
  import MachineLive from "$components/machines/machine-live.svelte";
  import MachineOverview from "$components/machines/machine-overview.svelte";
  import MachineProbes from "$components/machines/machine-probes.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import Button from "$components/ui/button/button.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let { data, form } = $props();
  function initialTab(detail: typeof data): "overview" | "config" {
    return detail.canManage &&
      (form?.kind === "machineConfig" ||
        form?.kind === "enrollment" ||
        form?.command !== undefined ||
        detail.requestedTab === "config")
      ? "config"
      : "overview";
  }

  let activeTab = $derived<"overview" | "probes" | "containers" | "events" | "config">(
    initialTab(data),
  );
  let currentLatest = $derived<DashboardMachine>(data.latest);
  const deleteError = $derived(form?.kind === "delete" && "message" in form ? form.message : null);

  const tabs = $derived([
    { id: "overview" as const, label: "Overview" },
    { id: "probes" as const, label: "Probes" },
    ...(data.machine.containersEnabled ? [{ id: "containers" as const, label: "Containers" }] : []),
    { id: "events" as const, label: "Events" },
    ...(data.canManage ? [{ id: "config" as const, label: "Config" }] : []),
  ]);

  function applyLiveSnapshot(snapshot: LiveViewerSnapshot) {
    if (snapshot.observedAt <= (currentLatest.observedAt ?? 0)) return;
    currentLatest = {
      ...currentLatest,
      observedAt: snapshot.observedAt,
      cpuPermille: snapshot.cpuPermille,
      memoryUsedBytes: snapshot.memoryUsedBytes,
      memoryTotalBytes: snapshot.memoryTotalBytes,
      storageUsedBytes: snapshot.storageUsedBytes,
      storageTotalBytes: snapshot.storageTotalBytes,
      networkRxBps: snapshot.networkRxBps,
      networkTxBps: snapshot.networkTxBps,
      networkRxTotal: snapshot.networkRxTotal,
      networkTxTotal: snapshot.networkTxTotal,
      load1mMilli: snapshot.load1mMilli,
      uptimeSeconds: snapshot.uptimeSeconds,
    };
  }

  function applyDurableFallback(latest: DashboardMachine) {
    if (latest.id !== data.machine.id || (latest.observedAt ?? 0) < (currentLatest.observedAt ?? 0))
      return;
    currentLatest = latest;
  }
</script>

<svelte:head><title>{data.machine.name} · {data.workspace.name}</title></svelte:head>

{#key `${data.workspace.id}:${data.machine.id}`}
  <main>
    <header class="page-header">
      <a href={`/${data.workspace.slug}/machines`}><ArrowLeft size={14} />Machines</a>
      <div class="title-row">
        <h1>{data.machine.name}</h1>
        <StatusLabel status={currentLatest.state} />
        {#if data.canManage}
          <form
            method="POST"
            action="?/delete"
            onsubmit={(event) => {
              if (
                !window.confirm(
                  `Delete ${data.machine.name}? It can be restored during the recovery window.`,
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <Button type="submit" variant="secondary"><Trash2 size={13} />Delete machine</Button>
          </form>
        {/if}
      </div>
      <p>
        {data.agent ? `${data.agent.platform} · ${data.agent.arch}` : "Agent not enrolled"}
        <span>Last report {formatRelativeTime(data.latest.observedAt)}</span>
      </p>
      <MachineLive
        active={activeTab === "overview" && data.agent !== null}
        ticketEndpoint={`/${data.workspace.slug}/machines/${data.machine.id}/live-ticket`}
        fallbackEndpoint={`/${data.workspace.slug}/machines/${data.machine.id}/latest`}
        initialObservedAt={data.latest.observedAt}
        onSnapshot={applyLiveSnapshot}
        onFallback={applyDurableFallback}
      />
    </header>

    {#if deleteError}<p class="page-error" role="alert">{deleteError}</p>{/if}

    <div class="machine-tabs">
      <Tabs.Root bind:value={activeTab}>
        <Tabs.List class="tabs" aria-label="Machine details">
          {#each tabs as tab}
            <Tabs.Trigger class="tab" value={tab.id}>{tab.label}</Tabs.Trigger>
          {/each}
        </Tabs.List>

        <Tabs.Content class="panel" value="overview">
          <MachineOverview detail={data} latest={currentLatest} />
        </Tabs.Content>
        <Tabs.Content class="panel" value="probes">
          <MachineProbes tasks={data.probeTasks} />
        </Tabs.Content>
        {#if data.machine.containersEnabled}
          <Tabs.Content class="panel" value="containers">
            <MachineContainers inventory={data.containerInventory} />
          </Tabs.Content>
        {/if}
        <Tabs.Content class="panel" value="events">
          <MachineEvents events={data.events} />
        </Tabs.Content>
        {#if data.canManage}
          <Tabs.Content class="panel" value="config">
            <MachineConfig machine={data.machine} result={form ?? null} />
            {#if data.canAdministerAgent}
              <MachineEnrollment
                tokens={data.enrollmentTokens}
                result={form ?? null}
                ingestOrigin={data.ingestOrigin}
                installOrigin={data.installOrigin}
                checksums={data.installerChecksums}
                manageHref={`/${data.workspace.slug}/machines/${data.machine.id}?tab=config`}
              />
            {/if}
            {#if data.agent}
              <AgentUpdateControls
                agent={data.agent}
                commands={data.agentCommands}
                result={form}
                canInstall={data.canAdministerAgent}
              />
            {/if}
          </Tabs.Content>
        {/if}
      </Tabs.Root>
    </div>
  </main>
{/key}

<style>
  main {
    width: min(100% - 48px, var(--content-wide));
    margin: 0 auto;
    padding: var(--space-6) 0 var(--space-8);
  }

  .page-header {
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .page-header > a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  .page-header > a:hover {
    color: var(--text);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .title-row form {
    margin-left: auto;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-header p {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .page-header p span::before {
    margin-right: var(--space-2);
    content: "·";
  }

  .page-error {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
  }

  .machine-tabs :global(.tabs) {
    display: flex;
    height: 38px;
    overflow-x: auto;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border);
  }

  .machine-tabs :global(.tab) {
    height: 100%;
    flex: none;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-button) var(--radius-button) 0 0;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: var(--text-base);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .machine-tabs :global(.tab:hover) {
    color: var(--text);
  }

  .machine-tabs :global(.tab:focus-visible) {
    outline-offset: -2px;
  }

  .machine-tabs :global(.tab:hover:not([data-state="active"])) {
    background: var(--surface-subtle);
  }

  .machine-tabs :global(.tab[data-state="active"]) {
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--accent);
    font-weight: 600;
  }

  .machine-tabs :global(.panel) {
    padding-top: var(--space-5);
  }

  @media (max-width: 768px) {
    main {
      width: min(100% - 32px, var(--content-wide));
    }
  }

  @media (max-width: 520px) {
    main {
      width: min(100% - 24px, var(--content-wide));
      padding-top: var(--space-4);
    }

    .machine-tabs :global(.tabs) {
      gap: 0;
    }

    .machine-tabs :global(.tab) {
      padding-inline: var(--space-2);
    }

    .title-row {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .title-row form {
      width: 100%;
      margin-left: 0;
    }

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
