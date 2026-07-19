<script lang="ts">
  import { Globe2, Plus, RadioTower, Server, ShieldCheck } from "lucide-svelte";

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
    result: { kind?: string; message?: string; created?: boolean } | null;
  } = $props();

  let kind = $state<"http" | "tcp" | "icmp">("http");
  let executor = $state<"cloudflare" | "agent">("cloudflare");

  function selectKind(next: typeof kind) {
    kind = next;
    if (next === "icmp") executor = "agent";
  }
</script>

<section id="add-check" class="add-check">
  <details open={result?.kind === "serviceCheck"}>
    <summary><Plus size={14} />Add check</summary>
    <form method="POST" action="?/addCheck">
      {#if result?.kind === "serviceCheck" && result.message}
        <p class="result result--error" role="alert">{result.message}</p>
      {:else if result?.kind === "serviceCheck" && result.created}
        <p class="result result--success" role="status">Check added.</p>
      {/if}

      <div class="segments" aria-label="Check type">
        <button
          type="button"
          class:active={kind === "http"}
          aria-pressed={kind === "http"}
          onclick={() => selectKind("http")}><Globe2 size={13} />HTTP</button
        >
        <button
          type="button"
          class:active={kind === "tcp"}
          aria-pressed={kind === "tcp"}
          onclick={() => selectKind("tcp")}><Server size={13} />TCP</button
        >
        <button
          type="button"
          class:active={kind === "icmp"}
          aria-pressed={kind === "icmp"}
          onclick={() => selectKind("icmp")}><RadioTower size={13} />ICMP</button
        >
      </div>
      <input type="hidden" name="kind" value={kind} />
      <label class="check-name"
        ><span>Check name</span><input
          name="checkName"
          required
          minlength="2"
          maxlength="80"
          placeholder="Regional availability"
        /></label
      >
      <ServiceTargetFields
        {kind}
        bind:executor
        {agents}
        pagination={agentPagination}
        agentAnchor="add-check"
      />
      <ServiceRequestFields {kind} {executor} />
      <ServiceScheduleFields {executor} />
      <footer><Button type="submit"><ShieldCheck size={14} />Add check</Button></footer>
    </form>
  </details>
</section>

<style>
  .add-check {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  form {
    display: grid;
    max-width: 760px;
    gap: 13px;
    margin-top: 14px;
  }

  .segments {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
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

  .check-name > span {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 620;
  }

  .check-name input {
    width: 100%;
    min-height: 32px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }

  .check-name input:focus {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }

  .result {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 10px;
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
    display: flex;
    justify-content: flex-end;
  }
</style>
