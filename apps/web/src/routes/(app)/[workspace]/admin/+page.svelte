<script lang="ts">
  import { Server } from "@lucide/svelte";

  import DeletedResourceList from "$components/admin/deleted-resource-list.svelte";
  import ServiceMonitorForm from "$components/admin/service-monitor-form.svelte";
  import EnrollmentCommand from "$components/machines/enrollment-command.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
</script>

<svelte:head><title>Resources · AlphaPing</title></svelte:head>

<main class="admin">
  {#if form?.kind === "machine" && form.machine}
    <EnrollmentCommand
      machineId={form.machine.machineId}
      tokenId={form.machine.tokenId}
      token={form.machine.token}
      expiresAt={form.machine.expiresAt}
      ingestOrigin={data.ingestOrigin}
      installOrigin={data.installOrigin}
      checksums={data.installerChecksums}
      manageHref={`/${data.workspace}/machines/${form.machine.machineId}?tab=config`}
    />
  {/if}

  <div class="admin__grid">
    <section>
      <header>
        <Server size={18} />
        <div>
          <h2>Add machine</h2>
          <p>Creates a 15 minute one-time enrollment token.</p>
        </div>
      </header>
      <form method="POST" action="?/machine">
        {#if form?.kind === "machine" && form.message}<p class="form-error" role="alert">
            {form.message}
          </p>{/if}
        <label
          ><span>Name</span><input
            name="name"
            required
            maxlength="80"
            placeholder="edge-01"
          /></label
        >
        <label
          ><span>Expected host or IP</span><input
            name="expectedHost"
            maxlength="253"
            placeholder="10.0.0.12"
          /></label
        >
        <label
          ><span>Description</span><textarea
            name="description"
            maxlength="500"
            rows="3"
            placeholder="Singapore edge gateway"></textarea></label
        >
        <label
          ><span>Labels</span><textarea
            name="labels"
            rows="3"
            placeholder="region=ap-southeast-1&#10;role=gateway"></textarea><small
            >One key=value label per line, up to 20.</small
          ></label
        >
        <div class="intervals">
          <label
            ><span>Sample every</span><input
              type="number"
              name="samplingIntervalSeconds"
              min="5"
              max="300"
              value={data.defaultSamplingIntervalSeconds}
              required
            /><small>seconds</small></label
          >
          <label
            ><span>Report every</span><input
              type="number"
              name="reportIntervalSeconds"
              min="60"
              max="900"
              value="60"
              required
            /><small>seconds</small></label
          >
          <label
            ><span>Offline after</span><input
              type="number"
              name="offlineAfterSeconds"
              min="60"
              max="86400"
              value="150"
              required
            /><small>seconds</small></label
          >
        </div>
        <label class="checkbox"
          ><input type="checkbox" name="containersEnabled" /><span>Enable container monitoring</span
          ></label
        >
        <Button type="submit">Create machine</Button>
      </form>
    </section>

    <div class="service-monitor">
      <ServiceMonitorForm
        agents={data.agents}
        agentPagination={data.agentPagination}
        result={form}
      />
    </div>
  </div>
  <DeletedResourceList resources={data.deletedResources} result={form ?? null} />
</main>

<style>
  .admin {
    width: 100%;
    padding-bottom: var(--space-8);
  }

  section header p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .admin__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
    padding-top: var(--space-2);
  }

  .admin__grid > .service-monitor {
    padding-left: var(--space-8);
    border-left: 1px solid var(--border);
  }

  section header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
  }

  section header > :global(svg) {
    color: var(--accent);
  }

  h2 {
    margin: 0 0 var(--space-1);
    font-size: 14px;
    font-weight: 600;
  }

  form {
    display: grid;
    gap: var(--space-4);
  }

  label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  input,
  textarea {
    width: 100%;
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
  }

  textarea {
    min-height: 72px;
    padding-block: var(--space-2);
    resize: vertical;
  }

  input:focus,
  textarea:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .checkbox input {
    width: 14px;
    height: 14px;
    min-height: 14px;
  }

  .checkbox span {
    margin: 0;
  }

  label small {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .intervals {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .form-error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
  }

  @media (max-width: 760px) {
    .admin__grid {
      grid-template-columns: 1fr;
    }

    .admin__grid > .service-monitor {
      padding-top: var(--space-8);
      padding-left: 0;
      border-top: 1px solid var(--border);
      border-left: 0;
    }
  }

  @media (max-width: 420px) {
    .intervals {
      grid-template-columns: 1fr;
    }
  }
</style>
