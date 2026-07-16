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
  </div>
</details>

<style>
  details {
    padding-block: 8px;
    border-bottom: 1px solid var(--border);
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
  div {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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
    outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  }
  @media (max-width: 680px) {
    div {
      grid-template-columns: 1fr;
    }
  }
</style>
