<script lang="ts">
  import { Activity, Globe2, RadioTower, Server, ShieldCheck } from "lucide-svelte";

  import ServiceRequestFields from "$components/admin/service-request-fields.svelte";
  import ServiceScheduleFields from "$components/admin/service-schedule-fields.svelte";
  import ServiceTargetFields from "$components/admin/service-target-fields.svelte";
  import Button from "$components/ui/button/button.svelte";

  let {
    agents,
    agentPagination,
    result,
  }: {
    agents: readonly { id: string; name: string }[];
    agentPagination: { page: number; hasPrevious: boolean; hasNext: boolean };
    result: { kind?: string; message?: string; created?: boolean; serviceId?: string } | null;
  } = $props();

  let kind = $state<"http" | "tcp" | "icmp">("http");
  let executor = $state<"cloudflare" | "agent">("cloudflare");

  function selectKind(next: typeof kind) {
    kind = next;
    if (next === "icmp") executor = "agent";
  }
</script>

<section id="service-monitor">
  <header>
    <Activity size={18} />
    <div>
      <h2>Add service monitor</h2>
      <p>HTTP, TCP, or Agent ICMP availability.</p>
    </div>
  </header>
  <form method="POST" action="?/service">
    {#if result?.kind === "service" && result.message}<p class="form-error" role="alert">
        {result.message}
      </p>{/if}
    {#if result?.kind === "service" && result.created}<p class="form-success">
        Service monitor created.
      </p>{/if}

    <div class="segments" aria-label="Check type">
      <button type="button" class:active={kind === "http"} onclick={() => selectKind("http")}
        ><Globe2 size={13} />HTTP</button
      >
      <button type="button" class:active={kind === "tcp"} onclick={() => selectKind("tcp")}
        ><Server size={13} />TCP</button
      >
      <button type="button" class:active={kind === "icmp"} onclick={() => selectKind("icmp")}
        ><RadioTower size={13} />ICMP</button
      >
    </div>
    <input type="hidden" name="kind" value={kind} />
    <div class="identity">
      <label
        ><span>Name</span><input
          name="name"
          required
          maxlength="80"
          placeholder="Public API"
        /></label
      ><label
        ><span>Description</span><input
          name="description"
          maxlength="500"
          placeholder="Production availability"
        /></label
      >
    </div>
    <ServiceTargetFields
      {kind}
      bind:executor
      {agents}
      pagination={agentPagination}
      agentAnchor="service-monitor"
    />
    <ServiceRequestFields {kind} {executor} />
    <ServiceScheduleFields {executor} />
    <Button type="submit"><ShieldCheck size={14} />Create service</Button>
  </form>
</section>

<style>
  section > header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 18px;
  }
  section > header > :global(svg) {
    color: var(--accent);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    margin-bottom: 3px;
    font-size: 15px;
  }
  header p {
    color: var(--text-muted);
    font-size: 12px;
  }
  form {
    display: grid;
    gap: 13px;
  }
  .segments {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    padding: 2px;
    border-radius: 6px;
    background: var(--surface-subtle);
  }
  .segments button {
    display: inline-flex;
    height: 28px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 0;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .segments button.active {
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border);
    font-weight: 650;
  }
  .identity {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  label > span {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 620;
  }
  input {
    width: 100%;
    min-height: 32px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }
  input:focus {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }
  .form-error,
  .form-success {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
  }
  .form-error {
    color: var(--status-down);
    background: var(--status-down-bg);
  }
  .form-success {
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }
  @media (max-width: 680px) {
    .identity {
      grid-template-columns: 1fr;
    }
  }
</style>
