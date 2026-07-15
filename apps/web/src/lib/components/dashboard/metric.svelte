<script lang="ts">
  let {
    label,
    value,
    detail,
    tone = "default",
  }: {
    label: string;
    value: string | number;
    detail?: string;
    tone?: "default" | "healthy" | "danger";
  } = $props();
</script>

<div class={`metric metric--${tone}`}>
  <span class="metric__label">{label}</span>
  <span class="metric__value">{value}</span>
  {#if detail}<span class="metric__detail">{detail}</span>{/if}
</div>

<style>
  .metric {
    min-width: 0;
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
