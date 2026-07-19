<script lang="ts">
  import { onMount } from "svelte";
  import {
    ArrowLeft,
    CalendarClock,
    ExternalLink,
    Globe2,
    LockKeyhole,
    Save,
    Trash2,
  } from "lucide-svelte";

  import ServiceCheckForm from "$components/services/service-check-form.svelte";
  import ServiceCheckList from "$components/services/service-check-list.svelte";
  import ServiceEvents from "$components/services/service-events.svelte";
  import ServiceHistoryPanel from "$components/services/service-history-panel.svelte";
  import ServiceSummary from "$components/services/service-summary.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
  let maintenanceUntil = $state("");
  let timezoneOffsetMinutes = $state(0);

  onMount(() => {
    timezoneOffsetMinutes = new Date().getTimezoneOffset();
    if (data.service.maintenanceUntil !== null) {
      maintenanceUntil = new Date(data.service.maintenanceUntil - timezoneOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 16);
    }
  });
</script>

<svelte:head><title>{data.service.name} · {data.workspace.name}</title></svelte:head>

<main>
  <header class="page-header">
    <div class="heading">
      <a href={`/${data.workspace.slug}/services`}><ArrowLeft size={14} />Services</a>
      <div class="title-row">
        <h1>{data.service.name}</h1>
        <StatusLabel status={data.service.state} />
      </div>
      {#if data.service.description}<p>{data.service.description}</p>{/if}
    </div>

    <div class="header-actions">
      {#if data.publicAccess}
        <a
          class="status-link"
          href={`/status/${data.workspace.slug}`}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} />View status page
        </a>
      {/if}
      {#if data.workspace.role === "admin"}
        <form method="POST" action="?/visibility">
          <input type="hidden" name="visibility" value={data.publicAccess ? "private" : "public"} />
          <Button type="submit" variant="secondary">
            {#if data.publicAccess}<LockKeyhole size={14} />Make private{:else}<Globe2
                size={14}
              />Publish{/if}
          </Button>
        </form>
      {/if}
      {#if data.service.canManage}
        <form
          method="POST"
          action="?/delete"
          onsubmit={(event) => {
            if (
              !window.confirm(
                `Delete ${data.service.name}? It can be restored during the recovery window.`,
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <Button type="submit" variant="secondary"><Trash2 size={13} />Delete service</Button>
        </form>
      {/if}
    </div>
  </header>

  {#if form?.message}<p class="form-message form-message--error" role="alert">
      {form.message}
    </p>{:else if form?.maintenanceUpdated}<p class="form-message" role="status">
      Maintenance window updated.
    </p>{/if}

  {#if data.service.canManage}
    <section class="maintenance">
      <div><CalendarClock size={16} /><span>Maintenance window</span></div>
      <form method="POST" action="?/maintenance">
        <label
          ><span>Suppress normal alerts until</span><input
            type="datetime-local"
            name="maintenanceUntil"
            bind:value={maintenanceUntil}
          /></label
        >
        <input type="hidden" name="timezoneOffsetMinutes" value={timezoneOffsetMinutes} />
        <Button type="submit" variant="secondary"><Save size={13} />Save</Button>
      </form>
    </section>
  {/if}

  <ServiceSummary service={data.service} />
  <ServiceHistoryPanel endpoint={`/${data.workspace.slug}/services/${data.service.id}/history`} />
  <ServiceCheckList
    checks={data.checks}
    canManage={data.service.canManage}
    result={form ?? null}
    historyBase={`/${data.workspace.slug}/services/${data.service.id}/checks`}
  />
  {#if data.service.canManage}
    <ServiceCheckForm
      agents={data.checkAgents.agents}
      agentPagination={data.checkAgents.pagination}
      result={form ?? null}
    />
  {/if}
  <ServiceEvents events={data.events} />
</main>

<style>
  main {
    width: min(100% - 24px, 1120px);
    margin: 0 auto;
    padding: 24px 0 48px;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    padding-bottom: 17px;
    border-bottom: 1px solid var(--border);
  }

  .heading {
    min-width: 0;
  }

  .heading > a,
  .status-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: none;
  }

  .heading > a:hover,
  .status-link:hover {
    color: var(--accent);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    font-size: 22px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heading p {
    max-width: 68ch;
    margin-top: 5px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .header-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
  }

  .form-message {
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
    font-size: 10px;
  }

  .form-message--error {
    color: var(--status-down);
    background: var(--status-down-bg);
  }

  .maintenance {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 10px;
    border-bottom: 1px solid var(--border);
  }

  .maintenance > div,
  .maintenance form {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .maintenance > div {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 650;
  }

  .maintenance label > span {
    display: block;
    margin-bottom: 4px;
    color: var(--text-faint);
    font-size: 9px;
  }

  .maintenance input {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }

  @media (max-width: 640px) {
    .page-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .heading {
      width: 100%;
    }

    .header-actions {
      width: 100%;
      justify-content: space-between;
    }

    .header-actions form:only-child {
      margin-left: auto;
    }

    .maintenance {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (max-width: 420px) {
    .header-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .header-actions form:only-child {
      margin-left: 0;
    }

    .maintenance form {
      width: 100%;
      align-items: stretch;
      flex-direction: column;
    }

    .maintenance input {
      width: 100%;
    }
  }

  @media (max-width: 340px) {
    .title-row {
      align-items: flex-start;
      flex-direction: column;
      gap: 6px;
    }

    .title-row h1 {
      width: 100%;
      flex: none;
    }
  }
</style>
