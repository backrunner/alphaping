<script lang="ts">
  import { page } from "$app/state";
  import { ChevronLeft, ChevronRight } from "lucide-svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  let {
    kind,
    executor = $bindable(),
    agents,
    pagination,
    agentAnchor,
  }: {
    kind: "http" | "tcp" | "icmp";
    executor: "cloudflare" | "agent";
    agents: readonly { id: string; name: string }[];
    pagination: { page: number; hasPrevious: boolean; hasNext: boolean };
    agentAnchor: string;
  } = $props();

  function agentPageHref(value: number): string {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    if (value <= 1) params.delete("agentPage");
    else params.set("agentPage", String(value));
    const query = params.toString();
    return `${page.url.pathname}${query ? `?${query}` : ""}#${agentAnchor}`;
  }
</script>

<div class="fields two">
  <label
    ><span>Executor</span><select name="executorKind" bind:value={executor}
      ><option value="cloudflare" disabled={kind === "icmp"}>Cloudflare</option><option
        value="agent">Agent</option
      ></select
    ></label
  >
  {#if executor === "agent"}<label
      ><span>Agent</span><select name="executorAgentId" required
        ><option value="">Select machine</option>{#each agents as agent}<option value={agent.id}
            >{agent.name}</option
          >{/each}</select
      >{#if pagination.hasPrevious || pagination.hasNext}<nav aria-label="Agent pages">
          {#if pagination.hasPrevious}<a href={agentPageHref(pagination.page - 1)}
              ><ChevronLeft size={12} />Previous</a
            >{:else}<span></span>{/if}<strong>Page {pagination.page}</strong
          >{#if pagination.hasNext}<a href={agentPageHref(pagination.page + 1)}
              >Next<ChevronRight size={12} /></a
            >{:else}<span></span>{/if}
        </nav>{/if}</label
    >{:else}<input type="hidden" name="executorAgentId" value="" />{/if}
</div>

{#if kind === "http"}
  <div class="fields url-row">
    <label
      ><span>Method</span><select name="method"
        ><option>GET</option><option>HEAD</option><option>POST</option><option>PUT</option><option
          >PATCH</option
        ><option>DELETE</option></select
      ></label
    ><label
      ><span>URL</span><input
        type="url"
        name="url"
        required
        placeholder="https://api.example.com/health"
      /></label
    >
  </div>
  <div class="fields three">
    <label><span>Expected status</span><input name="expectedStatuses" value="200" required /></label
    ><label
      ><span>Warn after, ms</span><input
        type="number"
        name="degradedAfterMs"
        min="0"
        max="30000"
        value="1500"
      /></label
    ><label
      ><span>Down after, ms</span><input
        type="number"
        name="downAfterMs"
        min="0"
        max="30000"
        value="5000"
      /></label
    >
  </div>
  <label
    ><span>Redirect limit</span><input
      type="number"
      name="maxRedirects"
      min="0"
      max="3"
      value="3"
    /><small>0 to 3 hops</small></label
  >
{:else}
  <div class="fields two">
    <label
      ><span>Hostname or IP</span><input
        name="hostname"
        required
        maxlength="253"
        placeholder="edge.example.com"
      /></label
    >{#if kind === "tcp"}<label
        ><span>Port</span><input
          type="number"
          name="port"
          required
          min="1"
          max="65535"
          value="443"
        /></label
      >{:else}<input type="hidden" name="port" value="" />{/if}
  </div>
  {#if kind === "tcp" && executor === "agent"}
    <label
      ><span>TLS SNI</span><input
        name="serverName"
        maxlength="253"
        placeholder="service.example.com"
      /></label
    >
  {:else}<input type="hidden" name="serverName" value="" />{/if}
  {#if kind === "icmp"}<div class="fields two">
      <label
        ><span>Warn after, ms</span><input
          type="number"
          name="degradedAfterMs"
          min="0"
          max="30000"
          value="150"
        /></label
      ><label
        ><span>Down after, ms</span><input
          type="number"
          name="downAfterMs"
          min="0"
          max="30000"
          value="1000"
        /></label
      >
    </div>{/if}
{/if}

{#if kind === "tcp"}
  <label class="inline-check"
    ><input type="checkbox" name="useTls" checked /><span>Use TLS</span></label
  >
  <div class="fields two">
    <label
      ><span>Send payload</span><textarea name="tcpPayload" rows="2" maxlength="4096"
      ></textarea><small><input type="checkbox" name="tcpPayloadIsSecret" /> Store as secret</small
      ></label
    ><label
      ><span>Expected response prefix</span><textarea
        name="tcpResponsePrefix"
        rows="2"
        maxlength="4096"
      ></textarea></label
    >
  </div>
  {#if executor === "agent"}
    <label class="inline-check"
      ><input type="checkbox" name="tlsVerify" checked /><span>Verify TLS certificates</span></label
    >
    <input type="hidden" name="tlsVerify" value="off" />
  {:else}<input type="hidden" name="tlsVerify" value="on" />{/if}
{/if}

<style>
  .fields {
    display: grid;
    gap: 10px;
  }
  .fields.two {
    grid-template-columns: repeat(2, 1fr);
  }
  .fields.three {
    grid-template-columns: repeat(3, 1fr);
  }
  .fields.url-row {
    grid-template-columns: 90px 1fr;
  }
  label > span {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 620;
  }
  input,
  select,
  textarea {
    width: 100%;
    min-height: 32px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }
  textarea {
    padding-block: 7px;
    resize: vertical;
  }
  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }
  label small {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 5px;
    color: var(--text-faint);
    font-size: 9px;
  }
  nav {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    margin-top: 5px;
    color: var(--text-faint);
    font-size: 9px;
  }
  nav a {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--accent);
    text-decoration: none;
  }
  nav a:last-child {
    justify-self: end;
  }
  nav strong {
    font-weight: 550;
  }
  label small input,
  .inline-check input {
    width: 13px;
    min-height: 13px;
  }
  .inline-check {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .inline-check span {
    margin: 0;
  }
  @media (max-width: 680px) {
    .fields.two,
    .fields.three,
    .fields.url-row {
      grid-template-columns: 1fr;
    }
  }
</style>
