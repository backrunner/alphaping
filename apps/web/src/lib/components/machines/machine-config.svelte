<script lang="ts">
  import { Settings } from "lucide-svelte";
  import type { MachineDetail } from "@alphaping/db";

  let { machine }: { machine: MachineDetail["machine"] } = $props();
</script>

<header>
  <div>
    <h2>Agent configuration</h2>
    <p>Applied values for sampling, reporting, and discovery.</p>
  </div>
  <Settings size={17} />
</header>
<dl>
  <div>
    <dt>Sampling interval</dt>
    <dd>{machine.samplingIntervalSeconds} seconds</dd>
  </div>
  <div>
    <dt>Report interval</dt>
    <dd>{machine.reportIntervalSeconds} seconds</dd>
  </div>
  <div>
    <dt>Offline after</dt>
    <dd>{machine.offlineAfterSeconds} seconds</dd>
  </div>
  <div>
    <dt>Container monitoring</dt>
    <dd>{machine.containersEnabled ? "Enabled" : "Disabled"}</dd>
  </div>
  <div>
    <dt>Desired revision</dt>
    <dd>{machine.desiredConfigRevision}</dd>
  </div>
</dl>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 11px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
  }

  p {
    color: var(--text-muted);
    font-size: 10px;
  }

  dl {
    margin: 0;
    border-block: 1px solid var(--border);
  }

  dl > div {
    display: flex;
    min-height: 42px;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 8px;
  }

  dl > div + div {
    border-top: 1px solid var(--border);
  }

  dt {
    color: var(--text-faint);
    font-size: 9px;
    text-transform: uppercase;
  }

  dd {
    margin: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
