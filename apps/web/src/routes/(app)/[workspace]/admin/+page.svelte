<script lang="ts">
  import { Server } from "lucide-svelte";

  import DeletedResourceList from "$components/admin/deleted-resource-list.svelte";
  import ServiceMonitorForm from "$components/admin/service-monitor-form.svelte";
  import EnrollmentCommand from "$components/machines/enrollment-command.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
</script>

<svelte:head><title>Developer · AlphaPing</title></svelte:head>

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
            placeholder="Singapore edge gateway"
          ></textarea></label
        >
        <label
          ><span>Labels</span><textarea
            name="labels"
            rows="3"
            placeholder="region=ap-southeast-1&#10;role=gateway"
          ></textarea><small>One key=value label per line, up to 20.</small></label
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

    <div class="service-monitor"><ServiceMonitorForm agents={data.agents} result={form} /></div>
  </div>
  <DeletedResourceList resources={data.deletedResources} result={form ?? null} />
</main>

<style>
  .admin {
    width: 100%;
    padding-bottom: 48px;
  }

  section header p {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .admin__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    padding-top: 8px;
  }

  .admin__grid > .service-monitor {
    padding-left: 28px;
    border-left: 1px solid var(--border);
  }

  section header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 18px;
  }

  section header > :global(svg) {
    color: var(--accent);
  }

  h2 {
    margin: 0 0 3px;
    font-size: 15px;
  }

  form {
    display: grid;
    gap: 14px;
  }

  label > span {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
  }

  input,
  textarea {
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }

  textarea {
    height: auto;
    min-height: 70px;
    padding-block: 8px;
    resize: vertical;
  }

  input:focus,
  textarea:focus {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .checkbox input {
    width: 15px;
    height: 15px;
  }

  .checkbox span {
    margin: 0;
  }

  label small {
    display: block;
    margin-top: 4px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .intervals {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .form-error {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
  }

  .form-error {
    color: var(--status-down);
    background: var(--status-down-bg);
  }

  @media (max-width: 760px) {
    .admin__grid {
      grid-template-columns: 1fr;
    }

    .admin__grid > .service-monitor {
      padding-top: 28px;
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
