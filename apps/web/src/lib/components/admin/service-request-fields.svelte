<script lang="ts">
  let { kind, executor }: { kind: "http" | "tcp" | "icmp"; executor: "cloudflare" | "agent" } =
    $props();

  type Assertion = {
    id: number;
    source: "header" | "jsonpath" | "body";
    operator: "exists" | "equals" | "contains" | "matches" | "type" | "greater_than" | "less_than";
  };

  let assertions = $state<Assertion[]>([]);
  let nextAssertionId = 0;

  function addAssertion() {
    if (assertions.length < 20) {
      assertions = [...assertions, { id: nextAssertionId, source: "body", operator: "contains" }];
      nextAssertionId += 1;
    }
  }

  function removeAssertion(index: number) {
    assertions = assertions.filter((_, current) => current !== index);
  }
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
          placeholder="Authorization: Bearer ..."
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
      >
      {#if executor === "agent"}
        <label class="inline-check"
          ><input type="checkbox" name="tlsVerify" checked /><span>Verify TLS certificates</span
          ></label
        >
        <input type="hidden" name="tlsVerify" value="off" />
      {:else}<input type="hidden" name="tlsVerify" value="on" />{/if}
    </div>

    <div class="assertions">
      <div class="assertions__header">
        <span>Response assertions ({assertions.length}/20)</span>
        <button type="button" onclick={addAssertion} disabled={assertions.length >= 20}
          >Add assertion</button
        >
      </div>
      {#each assertions as assertion, index (assertion.id)}
        <div class="assertion">
          <div class="fields two">
            <label
              ><span>Source</span><select name="assertionSource" bind:value={assertion.source}
                ><option value="header">Response header</option><option value="jsonpath"
                  >JSONPath</option
                ><option value="body">Response body</option></select
              ></label
            ><label
              ><span>Operator</span><select name="assertionOperator" bind:value={assertion.operator}
                ><option value="exists">Exists</option><option value="equals">Equals</option><option
                  value="contains">Contains</option
                ><option value="matches">RE2 matches</option><option value="type">Type</option
                ><option value="greater_than">Greater than</option><option value="less_than"
                  >Less than</option
                ></select
              ></label
            >
          </div>
          <div class="fields two">
            <label
              ><span>Selector</span><input
                name="assertionSelector"
                required={assertion.source !== "body"}
                placeholder={assertion.source === "jsonpath" ? "$.data.ready" : "x-release"}
              /></label
            ><label><span>Expected value</span><input name="assertionExpected" /></label>
          </div>
          <div class="assertion__footer">
            <label
              ><span>Failure state</span><select name="assertionSeverity"
                ><option value="down">Fault</option><option value="degraded">Degraded</option
                ></select
              ></label
            >
            <button type="button" onclick={() => removeAssertion(index)}>Remove</button>
          </div>
        </div>
      {:else}<p class="empty">No response assertions.</p>{/each}
    </div>
  {:else}
    <input type="hidden" name="requestHeaders" value="" /><input
      type="hidden"
      name="secretRequestHeaders"
      value=""
    /><input type="hidden" name="requestBody" value="" /><input
      type="hidden"
      name="maxResponseBytes"
      value="65536"
    />{#if kind === "icmp"}<input type="hidden" name="tlsVerify" value="on" />{/if}
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
  .assertions,
  .assertion {
    display: grid;
    gap: 10px;
  }

  .fields.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .assertions {
    gap: 8px;
    padding-top: 6px;
  }

  .assertions__header,
  .assertion__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .assertions__header {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
  }

  .assertions button,
  .assertion__footer button {
    border: 0;
    color: var(--accent);
    background: transparent;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .assertions button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .assertion {
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface-subtle);
  }

  .assertion__footer {
    align-items: flex-end;
  }

  .assertion__footer label {
    width: min(180px, 100%);
  }

  .empty {
    margin: 0;
    color: var(--text-faint);
    font-size: 10px;
  }

  .inline-check {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .inline-check input {
    width: 13px;
    min-height: 13px;
  }

  .inline-check span {
    margin: 0;
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
