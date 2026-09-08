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
    border-radius: var(--radius-button);
    color: inherit;
    text-decoration: none;
    transition: background-color 120ms ease;
  }

  a.metric:hover {
    background: var(--surface-subtle);
  }

  .metric__label {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .metric__value {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 22px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-xl);
  }

  .metric__detail {
    display: block;
    margin-top: 4px;
    color: var(--text-faint);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .metric--healthy .metric__value {
    color: var(--status-healthy);
  }

  .metric--danger .metric__value {
    color: var(--status-down);
  }
</style>
