<script lang="ts">
  import { ArrowLeft, ExternalLink, Globe2, LockKeyhole } from "lucide-svelte";

  import ServiceCheckList from "$components/services/service-check-list.svelte";
  import ServiceEvents from "$components/services/service-events.svelte";
  import ServiceSummary from "$components/services/service-summary.svelte";
  import StatusLabel from "$components/status/status-label.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
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
        <a class="status-link" href={`/status/${data.workspace.slug}`} target="_blank">
          <ExternalLink size={14} />View status page
        </a>
      {/if}
      {#if data.service.canManage}
        <form method="POST" action="?/visibility">
          <input type="hidden" name="visibility" value={data.publicAccess ? "private" : "public"} />
          <Button type="submit" variant="secondary">
            {#if data.publicAccess}<LockKeyhole size={14} />Make private{:else}<Globe2
                size={14}
              />Publish{/if}
          </Button>
        </form>
      {/if}
    </div>
  </header>

  {#if form?.message}<p class="form-message" role="alert">{form.message}</p>{/if}

  <ServiceSummary service={data.service} />
  <ServiceCheckList checks={data.checks} />
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
    border: 1px solid var(--status-down);
    border-radius: 6px;
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: 10px;
  }

  @media (max-width: 640px) {
    .page-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .header-actions {
      width: 100%;
      justify-content: space-between;
    }

    .header-actions form:only-child {
      margin-left: auto;
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
  }
</style>
