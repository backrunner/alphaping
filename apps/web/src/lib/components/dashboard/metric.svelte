<script lang="ts">
  let {
    label,
    value,
    detail,
    href,
    tone = "default",
  }: {
    label: string;
    value: string | number;
    detail?: string;
    href?: string;
    tone?: "default" | "healthy" | "danger";
  } = $props();
</script>

{#if href}
  <a class={`metric metric--${tone}`} {href}>
    <span class="metric__label">{label}</span>
    <span class="metric__value">{value}</span>
    {#if detail}<span class="metric__detail">{detail}</span>{/if}
  </a>
{:else}
  <div class={`metric metric--${tone}`}>
    <span class="metric__label">{label}</span>
    <span class="metric__value">{value}</span>
    {#if detail}<span class="metric__detail">{detail}</span>{/if}
  </div>
{/if}

<style>
  .metric {
    display: block;
    min-width: 0;
    border-radius: 4px;
    color: inherit;
    text-decoration: none;
  }

  a.metric:hover {
    background: var(--surface-subtle);
  }

  a.metric:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .metric__label {
    display: block;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .metric__value {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 620;
    font-variant-numeric: tabular-nums;
  }

  .metric__detail {
    margin-left: 5px;
    color: var(--text-faint);
    font-size: 11px;
  }

  .metric--healthy .metric__value {
    color: var(--status-healthy);
  }

  .metric--danger .metric__value {
    color: var(--status-down);
  }
</style>
