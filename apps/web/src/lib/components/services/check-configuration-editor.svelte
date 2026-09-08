<script lang="ts">
  import type { ServiceCheckSummary } from "@alphaping/db";
  import { Save, Settings2 } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";

  let {
    check,
    result,
  }: {
    check: ServiceCheckSummary;
    result: {
      kind?: string;
      checkId?: string;
      saved?: boolean;
      message?: string;
    } | null;
  } = $props();

  const config = $derived(check.editConfiguration);
  // The parent keys this component by check ID; local edits intentionally start from its mounted value.
  // svelte-ignore state_referenced_locally
  let assertions = $state(
    (check.editConfiguration?.assertions ?? []).map((assertion, id) => ({ ...assertion, id })),
  );

  function addAssertion() {
    if (assertions.length >= 20) return;
    const nextAssertionId =
      assertions.reduce((highest, assertion) => Math.max(highest, assertion.id), -1) + 1;
    assertions = [
      ...assertions,
      {
        id: nextAssertionId,
        source: "body" as const,
        operator: "contains" as const,
        selector: "",
        expected: "",
        severity: "down" as const,
      },
    ];
  }

  function removeAssertion(id: number) {
    assertions = assertions.filter((assertion) => assertion.id !== id);
  }
</script>

{#if config}
  <details class="configuration">
    <summary><Settings2 size={12} />Target & assertions</summary>
    <form method="POST" action="?/replaceCheckConfiguration">
      <input type="hidden" name="checkId" value={check.id} />
      <input type="hidden" name="kind" value={check.kind} />
      <input type="hidden" name="executorKind" value={check.executorKind} />
      <input type="hidden" name="executorAgentId" value={config.executorAgentId ?? ""} />
      <input type="hidden" name="intervalSeconds" value={check.intervalSeconds} />
      <input type="hidden" name="timeoutMs" value={check.timeoutMs} />
      <input type="hidden" name="retryCount" value={check.retryCount} />
      <input type="hidden" name="failureConfirmations" value={check.failureConfirmations} />
      <input type="hidden" name="recoveryConfirmations" value={check.recoveryConfirmations} />
      <input type="hidden" name="critical" value={check.critical ? "on" : "off"} />

      {#if result?.kind === "checkConfiguration" && result.checkId === check.id && result.message}
        <p class="message message--error" role="alert">{result.message}</p>
      {:else if result?.kind === "checkConfiguration" && result.checkId === check.id && result.saved}
        <p class="message" role="status">Target configuration replaced.</p>
      {/if}

      <label class="wide"
        ><span>Check name</span><input
          name="checkName"
          value={check.name}
          required
          minlength="2"
          maxlength="80"
        /></label
      >

      {#if check.kind === "http"}
        <div class="fields target-row">
          <label
            ><span>Method</span><select name="method">
              {#each ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as method}
                <option value={method} selected={config.method === method}>{method}</option>
              {/each}
            </select></label
          >
          <label><span>URL</span><input type="url" name="url" value={config.url} required /></label>
        </div>
        <div class="fields three">
          <label
            ><span>Expected status</span><input
              name="expectedStatuses"
              value={config.expectedStatuses}
              required
            /></label
          >
          <label
            ><span>Warn after, ms</span><input
              type="number"
              name="degradedAfterMs"
              min="0"
              max="30000"
              value={config.degradedAfterMs ?? ""}
            /></label
          >
          <label
            ><span>Down after, ms</span><input
              type="number"
              name="downAfterMs"
              min="0"
              max="30000"
              value={config.downAfterMs ?? ""}
            /></label
          >
        </div>
        <div class="fields two">
          <label
            ><span>Public request headers</span><textarea name="requestHeaders" rows="3"
              >{config.requestHeaders}</textarea
            ></label
          >
          <label
            ><span>Replacement secret headers</span><textarea name="secretRequestHeaders" rows="3"
            ></textarea>{#if config.secretHeaderNames.length > 0}<small
                >Stored: {config.secretHeaderNames.join(", ")}</small
              >{/if}</label
          >
        </div>
        <label class="wide"
          ><span>Request body</span><textarea name="requestBody" rows="3" maxlength="16384"
            >{config.requestBody}</textarea
          ><small
            ><input type="checkbox" name="requestBodyIsSecret" />Store replacement as secret{config.hasSecretBody
              ? "; stored secret preserved"
              : ""}</small
          ></label
        >
        <div class="fields three">
          <label
            ><span>Redirect limit</span><input
              type="number"
              name="maxRedirects"
              min="0"
              max="3"
              value={config.maxRedirects}
            /></label
          >
          <label
            ><span>Response limit</span><select name="maxResponseBytes">
              {#each [16_384, 65_536, 262_144] as size}
                <option value={size} selected={config.maxResponseBytes === size}
                  >{size / 1024} KiB</option
                >
              {/each}
            </select></label
          >
          <label class="inline-check"
            ><input type="checkbox" name="tlsVerify" checked={config.tlsVerify} /><span
              >Verify TLS</span
            ></label
          >
          <input type="hidden" name="tlsVerify" value="off" />
        </div>
      {:else}
        <div class="fields two">
          <label
            ><span>Hostname or IP</span><input
              name="hostname"
              value={config.hostname}
              maxlength="253"
              required
            /></label
          >
          {#if check.kind === "tcp"}<label
              ><span>Port</span><input
                type="number"
                name="port"
                min="1"
                max="65535"
                value={config.port ?? 443}
                required
              /></label
            >{:else}<input type="hidden" name="port" value="" />{/if}
        </div>
        {#if check.kind === "tcp"}
          <label class="wide"
            ><span>TLS SNI</span><input
              name="serverName"
              value={config.serverName}
              maxlength="253"
            /></label
          >
          <div class="fields two">
            <label
              ><span>Send payload</span><textarea name="tcpPayload" rows="2" maxlength="4096"
                >{config.tcpPayload}</textarea
              ><small
                ><input type="checkbox" name="tcpPayloadIsSecret" />Store replacement as secret{config.hasSecretTcpPayload
                  ? "; stored secret preserved"
                  : ""}</small
              ></label
            >
            <label
              ><span>Expected response prefix</span><textarea
                name="tcpResponsePrefix"
                rows="2"
                maxlength="4096">{config.tcpResponsePrefix}</textarea
              ></label
            >
          </div>
          <div class="binary-row">
            <label class="inline-check"
              ><input type="checkbox" name="useTls" checked={config.useTls} /><span>Use TLS</span
              ></label
            >
            <label class="inline-check"
              ><input type="checkbox" name="tlsVerify" checked={config.tlsVerify} /><span
                >Verify TLS</span
              ></label
            >
            <input type="hidden" name="tlsVerify" value="off" />
          </div>
        {:else}
          <input type="hidden" name="serverName" value="" />
          <input type="hidden" name="tlsVerify" value="on" />
          <input type="hidden" name="tcpPayload" value="" />
          <input type="hidden" name="tcpResponsePrefix" value="" />
          <div class="fields two">
            <label
              ><span>Warn after, ms</span><input
                type="number"
                name="degradedAfterMs"
                min="0"
                max="30000"
                value={config.degradedAfterMs ?? ""}
              /></label
            >
            <label
              ><span>Down after, ms</span><input
                type="number"
                name="downAfterMs"
                min="0"
                max="30000"
                value={config.downAfterMs ?? ""}
              /></label
            >
          </div>
        {/if}
        <input type="hidden" name="requestHeaders" value="" />
        <input type="hidden" name="secretRequestHeaders" value="" />
        <input type="hidden" name="requestBody" value="" />
        <input type="hidden" name="maxResponseBytes" value="65536" />
      {/if}

      {#if check.kind === "http"}
        <div class="assertions">
          <div class="assertion-header">
            <strong>Response assertions ({assertions.length}/20)</strong>
            <button type="button" onclick={addAssertion} disabled={assertions.length >= 20}
              >Add assertion</button
            >
          </div>
          {#each assertions as assertion (assertion.id)}
            <div class="assertion">
              <div class="fields two">
                <label
                  ><span>Source</span><select name="assertionSource" bind:value={assertion.source}>
                    <option value="header">Response header</option><option value="jsonpath"
                      >JSONPath</option
                    ><option value="body">Response body</option>
                  </select></label
                >
                <label
                  ><span>Operator</span><select
                    name="assertionOperator"
                    bind:value={assertion.operator}
                  >
                    {#each ["exists", "equals", "contains", "matches", "type", "greater_than", "less_than"] as operator}
                      <option value={operator}>{operator.replaceAll("_", " ")}</option>
                    {/each}
                  </select></label
                >
              </div>
              <div class="fields two">
                <label
                  ><span>Selector</span><input
                    name="assertionSelector"
                    value={assertion.selector}
                    required={assertion.source !== "body"}
                  /></label
                >
                <label
                  ><span>Expected value</span><input
                    name="assertionExpected"
                    value={assertion.expected}
                  /></label
                >
              </div>
              <div class="assertion-footer">
                <label
                  ><span>Failure state</span><select
                    name="assertionSeverity"
                    bind:value={assertion.severity}
                  >
                    <option value="down">Fault</option><option value="degraded">Degraded</option>
                  </select></label
                >
                <button type="button" onclick={() => removeAssertion(assertion.id)}>Remove</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <footer>
        <label class="inline-check replace-secrets"
          ><input type="checkbox" name="replaceSecrets" /><span>Replace all stored secrets</span
          ></label
        >
        <Button type="submit" variant="secondary"><Save size={12} />Replace target</Button>
      </footer>
    </form>
  </details>
{/if}

<style>
  .configuration {
    grid-column: 2 / -1;
  }
  summary {
    display: inline-flex;
    height: 26px;
    align-items: center;
    gap: var(--space-1);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 620;
    cursor: pointer;
  }
  summary:hover {
    color: var(--accent-hover);
  }
  form {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding: var(--space-3) 0 var(--space-1);
    border-top: 1px solid var(--border);
  }
  .fields {
    display: grid;
    gap: var(--space-2);
  }
  .fields.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .fields.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .fields.target-row {
    grid-template-columns: 96px 1fr;
  }
  label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  input,
  select,
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
    padding-block: var(--space-2);
    resize: vertical;
  }
  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }
  small {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  small input,
  .inline-check input {
    width: 14px;
    min-height: 14px;
  }
  .inline-check,
  .binary-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .binary-row {
    gap: var(--space-5);
  }
  .inline-check span {
    margin: 0;
  }
  .assertions {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }
  .assertion-header,
  .assertion-footer,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .assertion-header strong {
    display: block;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .assertion-header button,
  .assertion-footer button {
    border: 0;
    color: var(--accent);
    background: transparent;
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .assertion-header button:hover,
  .assertion-footer button:hover {
    color: var(--accent-hover);
  }
  .assertion-header button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .assertion {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-left: 2px solid var(--border-strong);
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
    background: var(--surface-subtle);
  }
  .assertion-footer {
    align-items: flex-end;
  }
  .assertion-footer label {
    width: min(180px, 100%);
  }
  .message {
    margin: 0;
    color: var(--status-healthy);
    font-size: var(--text-xs);
  }
  .message--error {
    color: var(--status-down);
  }
  .replace-secrets {
    margin-right: auto;
  }
  @media (max-width: 680px) {
    .fields.two,
    .fields.three,
    .fields.target-row {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 420px) {
    footer {
      align-items: stretch;
      flex-direction: column;
    }
    footer :global(button) {
      width: 100%;
      justify-content: center;
    }
  }
</style>
