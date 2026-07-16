<script lang="ts">
  let { kind }: { kind: "http" | "tcp" | "icmp" } = $props();
  let assertionSource = $state<"none" | "header" | "jsonpath" | "body">("none");
</script>

<details>
  <summary>Request and assertions</summary>
  {#if kind === "http"}
    <div class="fields two">
      <label
        ><span>Request headers</span><textarea
          name="requestHeaders"
          rows="3"
          placeholder="Accept: application/json"
        ></textarea></label
      ><label
        ><span>Secret request headers</span><textarea
          name="secretRequestHeaders"
          rows="3"
          placeholder="Authorization: Bearer …"
        ></textarea></label
      >
    </div>
    <label
      ><span>Request body</span><textarea name="requestBody" rows="3" maxlength="16384"
      ></textarea><small><input type="checkbox" name="requestBodyIsSecret" /> Store as secret</small
      ></label
    >
    <div class="fields two">
      <label
        ><span>Response limit</span><select name="maxResponseBytes"
          ><option value="16384">16 KiB</option><option value="65536" selected>64 KiB</option
          ><option value="262144">256 KiB</option></select
        ></label
      ><label
        ><span>Assertion source</span><select name="assertionSource" bind:value={assertionSource}
          ><option value="none">No assertion</option><option value="header">Response header</option
          ><option value="jsonpath">JSONPath</option><option value="body">Response body</option
          ></select
        ></label
      >
    </div>
    {#if assertionSource !== "none"}
      <div class="assertion">
        <div class="fields two">
          <label
            ><span>Selector</span><input
              name="assertionSelector"
              required={assertionSource !== "body"}
              placeholder={assertionSource === "jsonpath" ? "$.data.ready" : "x-release"}
            /></label
          ><label
            ><span>Operator</span><select name="assertionOperator"
              ><option value="exists">Exists</option><option value="equals">Equals</option><option
                value="contains">Contains</option
              ><option value="matches">RE2 matches</option><option value="type">Type</option><option
                value="greater_than">Greater than</option
              ><option value="less_than">Less than</option></select
            ></label
          >
        </div>
        <div class="fields two">
          <label><span>Expected value</span><input name="assertionExpected" /></label><label
            ><span>Failure state</span><select name="assertionSeverity"
              ><option value="down">Fault</option><option value="degraded">Degraded</option></select
            ></label
          >
        </div>
      </div>
    {/if}
  {:else}
    <input type="hidden" name="requestHeaders" value="" /><input
      type="hidden"
      name="secretRequestHeaders"
      value=""
    /><input type="hidden" name="requestBody" value="" /><input
      type="hidden"
      name="maxResponseBytes"
      value="65536"
    /><input type="hidden" name="assertionSource" value="none" />
  {/if}
</details>

<style>
  details {
    padding-block: 8px;
    border-block: 1px solid var(--border);
  }
  summary {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    cursor: pointer;
  }
  details[open] summary {
    margin-bottom: 12px;
  }
  .fields,
  .assertion {
    display: grid;
    gap: 10px;
  }
  .fields.two {
    grid-template-columns: repeat(2, 1fr);
  }
  .assertion {
    padding-top: 2px;
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
    outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  }
  label small {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 5px;
    color: var(--text-faint);
    font-size: 9px;
  }
  label small input {
    width: 13px;
    min-height: 13px;
  }
  @media (max-width: 680px) {
    .fields.two {
      grid-template-columns: 1fr;
    }
  }
</style>
