<script lang="ts">
  import { onMount } from "svelte";
  import { Save, Settings } from "lucide-svelte";
  import type { MachineDetail } from "@alphaping/db";

  import Button from "$components/ui/button/button.svelte";

  let {
    machine,
    result,
  }: { machine: MachineDetail["machine"]; result: Record<string, unknown> | null } = $props();
  const labels = $derived(
    Object.entries(machine.labels)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  let maintenanceUntil = $state("");
  let timezoneOffsetMinutes = $state(0);

  onMount(() => {
    timezoneOffsetMinutes = new Date().getTimezoneOffset();
    if (machine.maintenanceUntil !== null) {
      maintenanceUntil = new Date(machine.maintenanceUntil - timezoneOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 16);
    }
  });
</script>

<section>
  <header>
    <div>
      <h2>Agent configuration</h2>
      <p>Changes are delivered with the next authenticated Agent exchange.</p>
    </div>
    <Settings size={17} />
  </header>

  <form method="POST" action="?/updateConfig">
    {#if result?.kind === "machineConfig" && result.message}
      <p class="result result--error" role="alert">{String(result.message)}</p>
    {:else if result?.kind === "machineConfig" && result.saved}
      <p class="result result--success" role="status">
        Configuration saved as revision {String(result.revision)}.
      </p>
    {/if}

    <div class="identity">
      <label
        ><span>Name</span><input name="name" value={machine.name} maxlength="80" required /></label
      >
      <label
        ><span>Expected host or IP</span><input
          name="expectedHost"
          value={machine.expectedHost ?? ""}
          maxlength="253"
        /></label
      >
    </div>
    <label
      ><span>Description</span><textarea name="description" maxlength="500" rows="3"
        >{machine.description}</textarea
      ></label
    >
    <label
      ><span>Labels</span><textarea name="labels" rows="3">{labels}</textarea><small
        >One key=value label per line, up to 20.</small
      ></label
    >
    <div class="intervals">
      <label
        ><span>Sample every</span><input
          type="number"
          name="samplingIntervalSeconds"
          value={machine.samplingIntervalSeconds}
          min="5"
          max="300"
          required
        /><small>seconds</small></label
      >
      <label
        ><span>Report every</span><input
          type="number"
          name="reportIntervalSeconds"
          value={machine.reportIntervalSeconds}
          min="60"
          max="900"
          required
        /><small>divisible by sample interval</small></label
      >
      <label
        ><span>Offline after</span><input
          type="number"
          name="offlineAfterSeconds"
          value={machine.offlineAfterSeconds}
          min="60"
          max="86400"
          required
        /><small>seconds</small></label
      >
    </div>
    <div class="operations">
      <label
        ><span>Maintenance until</span><input
          type="datetime-local"
          name="maintenanceUntil"
          bind:value={maintenanceUntil}
        /><small>Leave empty to clear the maintenance window.</small></label
      >
      <input type="hidden" name="timezoneOffsetMinutes" value={timezoneOffsetMinutes} />
      <label class="checkbox"
        ><input type="checkbox" name="containersEnabled" checked={machine.containersEnabled} /><span
          >Enable container monitoring</span
        ></label
      >
    </div>
    <footer>
      <span>Current desired revision {machine.desiredConfigRevision}</span>
      <Button type="submit"><Save size={14} />Save configuration</Button>
    </footer>
  </form>
</section>

<style>
  section {
    max-width: 760px;
  }

  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  header {
    margin-bottom: 16px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
  }

  header p {
    color: var(--text-muted);
    font-size: 10px;
  }

  form {
    display: grid;
    gap: 14px;
    padding-block: 16px;
    border-block: 1px solid var(--border);
  }

  .identity,
  .intervals,
  .operations {
    display: grid;
    gap: 10px;
  }

  .identity,
  .operations {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .intervals {
    grid-template-columns: repeat(3, minmax(0, 1fr));
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

  label small {
    display: block;
    margin-top: 4px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .checkbox {
    display: flex;
    min-height: 36px;
    align-items: center;
    align-self: end;
    gap: 8px;
  }

  .checkbox input {
    width: 15px;
    height: 15px;
  }

  .checkbox span {
    margin: 0;
  }

  .result {
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
  }

  .result--error {
    color: var(--status-down);
    background: var(--status-down-bg);
  }

  .result--success {
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }

  footer {
    padding-top: 2px;
  }

  footer > span {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  @media (max-width: 640px) {
    .identity,
    .operations {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 420px) {
    .intervals {
      grid-template-columns: 1fr;
    }

    footer {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
