<script lang="ts">
  let { executor }: { executor: "cloudflare" | "agent" } = $props();
</script>

<details>
  <summary>Schedule and confirmation</summary>
  <div>
    <label
      ><span>Interval, seconds</span><input
        type="number"
        name="intervalSeconds"
        min={executor === "cloudflare" ? 60 : 5}
        max="86400"
        value="60"
        required
      /></label
    ><label
      ><span>Timeout, ms</span><input
        type="number"
        name="timeoutMs"
        min="100"
        max="30000"
        value="5000"
        required
      /></label
    ><label
      ><span>Retries</span><input
        type="number"
        name="retryCount"
        min="0"
        max="3"
        value="0"
        required
      /></label
    ><label
      ><span>Failure count</span><input
        type="number"
        name="failureConfirmations"
        min="1"
        max="20"
        value="3"
        required
      /></label
    ><label
      ><span>Recovery count</span><input
        type="number"
        name="recoveryConfirmations"
        min="1"
        max="20"
        value="2"
        required
      /></label
    >
    <label class="inline-check"
      ><input type="checkbox" name="critical" checked /><span>Critical check</span></label
    >
    <input type="hidden" name="critical" value="off" />
  </div>
</details>

<style>
  details {
    padding-block: var(--space-2);
    border-bottom: 1px solid var(--border);
  }
  summary {
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 620;
    cursor: pointer;
  }
  summary:hover {
    color: var(--text);
  }
  details[open] summary {
    margin-bottom: var(--space-3);
  }
  div {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 620;
  }
  input {
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
  input:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .inline-check {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .inline-check input {
    width: 14px;
    min-height: 14px;
  }
  .inline-check span {
    margin: 0;
  }
  @media (max-width: 680px) {
    div {
      grid-template-columns: 1fr;
    }
  }
</style>
